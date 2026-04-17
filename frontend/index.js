const API      = "https://movielens-backend-s49l.onrender.com/movielens/api";
const TMDB_KEY = "c862dda96952702fa0e248dc1f1f0937";
const TMDB_IMG = "https://image.tmdb.org/t/p/w92";
const PER_PAGE = 10;

// ─────────────────────────────────────────
// ΚΑΤΑΣΤΑΣΗ
// ─────────────────────────────────────────
let currentMovies   = [];
let currentAverages = {};
let currentPage     = 1;
let posterCache     = {};
let imdbHidden      = false;

// ─────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast     = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ─────────────────────────────────────────
// SKELETON LOADING
// ─────────────────────────────────────────
function showSkeleton(tbodyId, cols = 6, rows = 5) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = "";
    for (let i = 0; i < rows; i++) {
        const tr = document.createElement("tr");
        tr.className = "skeleton-row";
        for (let j = 0; j < cols; j++) {
            const td  = document.createElement("td");
            const div = document.createElement("div");
            div.className = `skeleton ${j === 0 ? "skeleton-poster" : j === 1 ? "skeleton-text-long" : j === 2 ? "skeleton-text-short" : "skeleton-text-tiny"}`;
            td.appendChild(div);
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
}

// ─────────────────────────────────────────
// ΑΠΟΘΗΚΕΥΣΗ SESSION
// ─────────────────────────────────────────
function loadFromStorage() {
    try {
        const ratings   = localStorage.getItem("myRatings");
        const watchlist = localStorage.getItem("myWatchlist");
        return {
            ratings:   ratings   ? JSON.parse(ratings)   : {},
            watchlist: watchlist ? JSON.parse(watchlist) : {}
        };
    } catch {
        return { ratings: {}, watchlist: {} };
    }
}

function saveToStorage() {
    try {
        localStorage.setItem("myRatings",   JSON.stringify(myRatings));
        localStorage.setItem("myWatchlist", JSON.stringify(myWatchlist));
    } catch (e) {
        console.error("Σφάλμα αποθήκευσης:", e);
    }
}

const saved     = loadFromStorage();
let myRatings   = saved.ratings;
let myWatchlist = saved.watchlist;

// ─────────────────────────────────────────
// ΙΣΤΟΡΙΚΟ ΑΝΑΖΗΤΗΣΕΩΝ
// ─────────────────────────────────────────
function loadSearchHistory() {
    try {
        const h = localStorage.getItem("searchHistory");
        return h ? JSON.parse(h) : [];
    } catch { return []; }
}

function saveSearchHistory(history) {
    localStorage.setItem("searchHistory", JSON.stringify(history));
}

function addToSearchHistory(keyword) {
    let history = loadSearchHistory();
    history = history.filter(h => h !== keyword); // αφαιρούμε διπλότυπα
    history.unshift(keyword);                       // προσθέτουμε στην αρχή
    history = history.slice(0, 8);                 // κρατάμε μόνο 8
    saveSearchHistory(history);
    renderSearchHistory();
}

function renderSearchHistory() {
    const container = document.getElementById("search-history-container");
    const tagsDiv   = document.getElementById("search-history-tags");
    const history   = loadSearchHistory();

    if (history.length === 0) {
        container.classList.add("hidden");
        return;
    }

    container.classList.remove("hidden");
    tagsDiv.innerHTML = history.map(h =>
        `<span class="history-tag" onclick="searchFromHistory('${h.replace(/'/g, "\\'")}')">${h}</span>`
    ).join("");
}

function searchFromHistory(keyword) {
    document.getElementById("search-input").value = keyword;
    searchMovies();
}

function clearSearchHistory() {
    localStorage.removeItem("searchHistory");
    renderSearchHistory();
    showToast("Ιστορικό αναζητήσεων καθαρίστηκε!", "info");
}

// ─────────────────────────────────────────
// ΤΑΙΝΙΑ ΤΗΣ ΗΜΕΡΑΣ
// ─────────────────────────────────────────
async function loadDailyMovie() {
    const container = document.getElementById("daily-movie-content");
    container.innerHTML = `<div class="skeleton" style="height:120px; border-radius:8px;"></div>`;

    try {
        // Χρησιμοποιούμε την ημερομηνία σαν seed για να είναι ίδια ταινία όλη μέρα
        const today    = new Date().toISOString().split("T")[0];
        const seed     = today.split("-").reduce((a, b) => parseInt(a) + parseInt(b), 0);
        const letter   = "abcdefghijklmnopqrstuvwxyz"[seed % 26];

        const res      = await fetch(`${API}/movies?search=${letter}`);
        const data     = await res.json();

        if (!data.movies || data.movies.length === 0) {
            container.innerHTML = "<p class='hint'>Δεν βρέθηκε ταινία σήμερα.</p>";
            return;
        }

        // Επιλογή ταινίας βάσει ημερομηνίας
        const movie  = data.movies[seed % data.movies.length];
        const year   = extractYear(movie.title) || "—";
        const poster = await fetchPoster(movie.title, extractYear(movie.title));

        // Φέρνουμε μέση βαθμολογία
        const avgRes  = await fetch(`${API}/average-ratings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ movieIds: [movie.movieId] })
        });
        const avgData = await avgRes.json();
        const info    = avgData.averages[movie.movieId];
        const avg     = info ? `${info.avg} ★ (${info.count} ψήφοι)` : "Χωρίς βαθμολογία";

        const posterEl = poster
            ? `<img src="${poster}" alt="Αφίσα">`
            : `<div class="daily-no-poster">🎬</div>`;

        container.innerHTML = `
            <div class="daily-card">
                ${posterEl}
                <div class="daily-info">
                    <h3>${movie.title}</h3>
                    <div class="daily-meta">
                        🎭 ${movie.genres.replace(/\|/g, " · ")} &nbsp;|&nbsp;
                        📅 ${year} &nbsp;|&nbsp;
                        ⭐ ${avg}
                    </div>
                    <div class="daily-actions">
                        <a class="trailer-link" href="${trailerLink(movie.title)}" target="_blank">▶ Trailer</a>
                        <button class="watchlist-btn" onclick="addToWatchlist(${movie.movieId}, '${movie.title.replace(/'/g, "\\'")}', '${movie.genres.replace(/'/g, "\\'")}')">
                            + Watchlist
                        </button>
                        <button onclick="loadDailyMovie()">🔀 Άλλη ταινία</button>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = "<p class='hint'>Σφάλμα φόρτωσης ταινίας.</p>";
    }
}

// ─────────────────────────────────────────
// DARK MODE
// ─────────────────────────────────────────
function toggleTheme() {
    const html = document.documentElement;
    const btn  = document.getElementById("theme-toggle");
    if (html.getAttribute("data-theme") === "dark") {
        html.setAttribute("data-theme", "light");
        btn.textContent = "🌙 Dark Mode";
        localStorage.setItem("theme", "light");
    } else {
        html.setAttribute("data-theme", "dark");
        btn.textContent = "☀️ Light Mode";
        localStorage.setItem("theme", "dark");
    }
}

function loadTheme() {
    const theme = localStorage.getItem("theme");
    if (theme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        const btn = document.getElementById("theme-toggle");
        if (btn) btn.textContent = "☀️ Light Mode";
    }
}

// ─────────────────────────────────────────
// ΒΟΗΘΗΤΙΚΕΣ
// ─────────────────────────────────────────
function extractYear(title) {
    const match = title.match(/\((\d{4})\)/);
    return match ? parseInt(match[1]) : null;
}

function cleanTitle(title) {
    return title.replace(/\s*\(\d{4}\)\s*$/, "").trim();
}

function trailerLink(title) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(title + " trailer")}`;
}

function getActiveRatings() {
    if (!imdbHidden) return myRatings;
    const active = {};
    for (const [id, v] of Object.entries(myRatings)) {
        if (!v.fromIMDb) active[id] = v;
    }
    return active;
}

// ─────────────────────────────────────────
// TOGGLE IMDB
// ─────────────────────────────────────────
function toggleIMDbRatings() {
    imdbHidden = !imdbHidden;
    const btn  = document.getElementById("toggle-imdb-btn");
    if (imdbHidden) {
        btn.textContent = "👁️ Εμφάνιση IMDb";
        btn.classList.add("active");
    } else {
        btn.textContent = "🙈 Απόκρυψη IMDb";
        btn.classList.remove("active");
    }
    updateRatingsList();
    showStats();
}

// ─────────────────────────────────────────
// TOGGLE RATINGS LIST
// ─────────────────────────────────────────
function toggleRatingsList() {
    const list = document.getElementById("my-ratings-list");
    const btn  = document.getElementById("toggle-ratings-btn");
    if (list.style.display === "none") {
        list.style.display = "";
        btn.textContent    = "🔼 Απόκρυψη";
    } else {
        list.style.display = "none";
        btn.textContent    = "🔽 Εμφάνιση";
    }
}

// ─────────────────────────────────────────
// TMDB
// ─────────────────────────────────────────
async function fetchPoster(title, year) {
    const key = `${title}_${year}`;
    if (posterCache[key] !== undefined) return posterCache[key];
    try {
        const query = encodeURIComponent(cleanTitle(title));
        const yearP = year ? `&year=${year}` : "";
        const url   = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${query}${yearP}&language=en-US`;
        const res   = await fetch(url);
        const data  = await res.json();
        if (data.results?.length > 0 && data.results[0].poster_path) {
            const path = TMDB_IMG + data.results[0].poster_path;
            posterCache[key] = path;
            return path;
        }
    } catch { }
    posterCache[key] = null;
    return null;
}

async function posterHTML(title) {
    const year = extractYear(title);
    const src  = await fetchPoster(title, year);
    if (src) return `<img class="movie-poster" src="${src}" alt="Αφίσα" loading="lazy">`;
    return `<div class="no-poster">🎬</div>`;
}

// ─────────────────────────────────────────
// SORTING
// ─────────────────────────────────────────
function applySortAndRender() {
    const field = document.getElementById("sort-field").value;
    const dir   = document.getElementById("sort-dir").value;
    currentMovies.sort((a, b) => {
        let valA, valB;
        if (field === "title") {
            valA = a.title.toLowerCase();
            valB = b.title.toLowerCase();
        } else if (field === "year") {
            valA = extractYear(a.title) || 0;
            valB = extractYear(b.title) || 0;
        } else {
            valA = currentAverages[a.movieId]?.avg || 0;
            valB = currentAverages[b.movieId]?.avg || 0;
        }
        if (valA < valB) return dir === "asc" ? -1 :  1;
        if (valA > valB) return dir === "asc" ?  1 : -1;
        return 0;
    });
    currentPage = 1;
    renderPage();
}

// ─────────────────────────────────────────
// PAGINATION + RENDER
// ─────────────────────────────────────────
function changePage(delta) {
    const total = Math.ceil(currentMovies.length / PER_PAGE);
    currentPage = Math.max(1, Math.min(currentPage + delta, total));
    renderPage();
}

async function renderPage() {
    const tbody      = document.getElementById("search-results-body");
    const table      = document.getElementById("search-results");
    const pagination = document.getElementById("pagination-controls");
    const pageInfo   = document.getElementById("page-info");
    const total      = Math.ceil(currentMovies.length / PER_PAGE);
    const start      = (currentPage - 1) * PER_PAGE;
    const pageMovies = currentMovies.slice(start, start + PER_PAGE);

    table.classList.remove("hidden");
    showSkeleton("search-results-body", 6, pageMovies.length);

    tbody.innerHTML = "";
    for (const movie of pageMovies) {
        const info   = currentAverages[movie.movieId];
        const avg    = info ? `${info.avg} ★ (${info.count} ψήφοι)` : "—";
        const year   = extractYear(movie.title) || "—";
        const poster = await posterHTML(movie.title);
        const tr     = document.createElement("tr");
        tr.innerHTML = `
            <td>${poster}</td>
            <td>${movie.title}</td>
            <td>${movie.genres}</td>
            <td>${year}</td>
            <td>${avg}</td>
            <td>
                <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    <select class="rating-select" id="rating-${movie.movieId}">
                        <option value="">—</option>
                        ${[0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].map(v =>
                            `<option value="${v}">${v} ★</option>`
                        ).join("")}
                    </select>
                    <button onclick="rateMovie(${movie.movieId}, '${movie.title.replace(/'/g, "\\'")}')">Αποθήκευση</button>
                    <a class="trailer-link" href="${trailerLink(movie.title)}" target="_blank">▶ Trailer</a>
                    <button class="watchlist-btn" onclick="addToWatchlist(${movie.movieId}, '${movie.title.replace(/'/g, "\\'")}', '${movie.genres.replace(/'/g, "\\'")}')">+ Watchlist</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    }

    pageInfo.textContent = `Σελίδα ${currentPage} από ${total} (${currentMovies.length} ταινίες)`;
    pagination.classList.remove("hidden");
}

// ─────────────────────────────────────────
// ΑΝΑΖΗΤΗΣΗ
// ─────────────────────────────────────────
async function searchMovies() {
    const keyword  = document.getElementById("search-input").value.trim();
    const yearFrom = parseInt(document.getElementById("year-from").value) || null;
    const yearTo   = parseInt(document.getElementById("year-to").value)   || null;
    const errorDiv = document.getElementById("search-error");
    const sortCtrl = document.getElementById("sort-controls");

    errorDiv.textContent = "";

    if (!keyword) {
        showToast("Παρακαλώ εισάγετε λέξη-κλειδί!", "error");
        return;
    }

    try {
        const res  = await fetch(`${API}/movies?search=${encodeURIComponent(keyword)}`);
        const data = await res.json();

        let movies = data.movies;
        if (yearFrom || yearTo) {
            movies = movies.filter(m => {
                const y = extractYear(m.title);
                if (!y) return false;
                if (yearFrom && y < yearFrom) return false;
                if (yearTo   && y > yearTo)   return false;
                return true;
            });
        }

        if (movies.length === 0) {
            showToast("Δεν βρέθηκαν ταινίες!", "error");
            document.getElementById("search-results").classList.add("hidden");
            document.getElementById("pagination-controls").classList.add("hidden");
            sortCtrl.classList.add("hidden");
            return;
        }

        const movieIds = movies.map(m => m.movieId);
        const avgRes   = await fetch(`${API}/average-ratings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ movieIds })
        });
        const avgData = await avgRes.json();

        currentMovies   = movies;
        currentAverages = avgData.averages;
        currentPage     = 1;

        // Αποθήκευση στο ιστορικό
        addToSearchHistory(keyword);

        sortCtrl.classList.remove("hidden");
        showToast(`Βρέθηκαν ${movies.length} ταινίες!`, "success");
        renderPage();

    } catch (err) {
        showToast("Σφάλμα σύνδεσης με τον server!", "error");
    }
}

// ─────────────────────────────────────────
// ΒΑΘΜΟΛΟΓΗΣΗ
// ─────────────────────────────────────────
function rateMovie(movieId, title) {
    const select = document.getElementById(`rating-${movieId}`);
    const rating = parseFloat(select.value);
    if (!rating) {
        showToast("Παρακαλώ επίλεξε βαθμολογία πρώτα!", "error");
        return;
    }
    myRatings[movieId] = { title, rating, fromIMDb: false };
    saveToStorage();
    updateRatingsList();
    showToast(`"${title}" → ${rating} ★`, "success");
}

function updateRatingsList() {
    const div     = document.getElementById("my-ratings-list");
    const active  = getActiveRatings();
    const entries = Object.entries(active);
    const total   = Object.keys(myRatings).length;
    const hidden  = total - entries.length;

    if (entries.length === 0 && total === 0) {
        div.textContent = "Δεν έχεις βαθμολογήσει ακόμα καμία ταινία.";
        return;
    }

    let html = "<strong>Οι βαθμολογίες σου:</strong>";
    if (hidden > 0) html += ` <span style="color:var(--text-muted); font-size:0.85rem;">(${hidden} IMDb κρυμμένες)</span>`;
    html += "<br>";
    if (entries.length === 0) {
        html += "<span style='color:var(--text-muted);'>Όλες κρυμμένες.</span>";
    } else {
        html += entries.map(([, v]) => `<span>${v.title}: ${v.rating} ★</span>`).join("");
    }
    div.innerHTML = html;
}

// ─────────────────────────────────────────
// WATCHLIST
// ─────────────────────────────────────────
function addToWatchlist(movieId, title, genres) {
    if (myWatchlist[movieId]) {
        showToast(`"${title}" υπάρχει ήδη στη Watchlist!`, "error");
        return;
    }
    myWatchlist[movieId] = { title, genres };
    saveToStorage();
    updateWatchlist();
    showToast(`Προστέθηκε: "${title}"`, "success");
}

function removeFromWatchlist(movieId) {
    delete myWatchlist[movieId];
    saveToStorage();
    updateWatchlist();
    showToast("Αφαιρέθηκε από τη Watchlist", "info");
}

function clearWatchlist() {
    if (!confirm("Σίγουρα θέλεις να διαγράψεις ολόκληρη τη Watchlist;")) return;
    myWatchlist = {};
    saveToStorage();
    updateWatchlist();
    showToast("Watchlist καθαρίστηκε!", "info");
}

function updateWatchlist() {
    const tbody   = document.getElementById("watchlist-body");
    const table   = document.getElementById("watchlist-table");
    const empty   = document.getElementById("watchlist-empty");
    const entries = Object.entries(myWatchlist);

    if (entries.length === 0) {
        table.classList.add("hidden");
        empty.classList.remove("hidden");
        return;
    }

    empty.classList.add("hidden");
    table.classList.remove("hidden");
    tbody.innerHTML = "";

    for (const [movieId, m] of entries) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${m.title}</td>
            <td>${m.genres}</td>
            <td><a class="trailer-link" href="${trailerLink(m.title)}" target="_blank">▶ Trailer</a></td>
            <td><button class="remove-btn" onclick="removeFromWatchlist(${movieId})">Αφαίρεση</button></td>
        `;
        tbody.appendChild(tr);
    }
}

function exportWatchlist() {
    const entries = Object.entries(myWatchlist);
    if (entries.length === 0) {
        showToast("Η Watchlist είναι άδεια!", "error");
        return;
    }
    const csv  = "Τίτλος,Είδος,Trailer\n" + entries.map(([, m]) =>
        `"${m.title}","${m.genres}","${trailerLink(m.title)}"`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "watchlist.csv"; a.click();
    URL.revokeObjectURL(url);
    showToast("Watchlist εξήχθη επιτυχώς!", "success");
}

// ─────────────────────────────────────────
// ΠΡΟΣΘΗΚΗ ΤΑΙΝΙΑΣ
// ─────────────────────────────────────────
async function addMovie() {
    const title    = document.getElementById("add-title").value.trim();
    const genres   = document.getElementById("add-genres").value.trim();
    const feedback = document.getElementById("add-feedback");

    feedback.textContent = "";
    feedback.className   = "feedback-msg";

    if (!title || !genres) {
        showToast("Παρακαλώ συμπλήρωσε τίτλο και είδος!", "error");
        return;
    }

    try {
        const res  = await fetch(`${API}/movies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, genres })
        });
        const data = await res.json();
        if (data.status === "success") {
            showToast(`Ταινία προστέθηκε με ID: ${data.movieId}`, "success");
            document.getElementById("add-title").value  = "";
            document.getElementById("add-genres").value = "";
        } else {
            showToast("Κάτι πήγε στραβά!", "error");
        }
    } catch (err) {
        showToast("Σφάλμα σύνδεσης με τον server!", "error");
    }
}

// ─────────────────────────────────────────
// ΣΥΣΤΑΣΕΙΣ
// ─────────────────────────────────────────
async function getRecommendations() {
    const errorDiv    = document.getElementById("rec-error");
    const table       = document.getElementById("rec-results");
    const tbody       = document.getElementById("rec-results-body");
    const genre       = document.getElementById("rec-genre").value;
    const n           = parseInt(document.getElementById("rec-n").value);
    const recYearFrom = parseInt(document.getElementById("rec-year-from").value) || null;
    const recYearTo   = parseInt(document.getElementById("rec-year-to").value)   || null;
    const btn         = document.getElementById("rec-btn");

    errorDiv.textContent = "";
    btn.textContent      = "⏳ Υπολογισμός...";
    btn.disabled         = true;

    const active  = getActiveRatings();
    const entries = Object.entries(active);

    if (entries.length < 2) {
        showToast("Χρειάζονται τουλάχιστον 2 βαθμολογίες!", "error");
        btn.textContent = "Λήψη Προτάσεων";
        btn.disabled    = false;
        return;
    }

    table.classList.remove("hidden");
    showSkeleton("rec-results-body", 6, 5);

    const ratingsPayload = entries.map(([movieId, v]) => ({
        movieId: parseInt(movieId),
        rating:  v.rating
    }));

    try {
        const res  = await fetch(`${API}/recommendations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(120000),
            body: JSON.stringify({
                ratings:      ratingsPayload,
                genres:       genre,
                exclude_seen: true,
                n:            n * 3
            })
        });
        const data = await res.json();

        let recs = data.recommendations;

        if (recYearFrom || recYearTo) {
            recs = recs.filter(r => {
                const y = extractYear(r.title);
                if (!y) return false;
                if (recYearFrom && y < recYearFrom) return false;
                if (recYearTo   && y > recYearTo)   return false;
                return true;
            });
        }

        recs = recs.slice(0, n);

        if (recs.length === 0) {
            showToast("Δεν βρέθηκαν προτάσεις!", "error");
            table.classList.add("hidden");
            btn.textContent = "Λήψη Προτάσεων";
            btn.disabled    = false;
            return;
        }

        tbody.innerHTML = "";
        for (const rec of recs) {
            const year   = extractYear(rec.title) || "—";
            const poster = await posterHTML(rec.title);
            const tr     = document.createElement("tr");
            tr.innerHTML = `
                <td>${poster}</td>
                <td>${rec.title}</td>
                <td>${rec.genres}</td>
                <td>${year}</td>
                <td>${rec.predictedRating} ★</td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <a class="trailer-link" href="${trailerLink(rec.title)}" target="_blank">▶ Trailer</a>
                        <button class="watchlist-btn" onclick="addToWatchlist(${rec.movieId}, '${rec.title.replace(/'/g, "\\'")}', '${rec.genres.replace(/'/g, "\\'")}')">+ Watchlist</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }

        table.classList.remove("hidden");
        showToast(`${recs.length} προτάσεις βρέθηκαν!`, "success");

    } catch (err) {
        showToast("Σφάλμα σύνδεσης με τον server!", "error");
        table.classList.add("hidden");
    } finally {
        btn.textContent = "Λήψη Προτάσεων";
        btn.disabled    = false;
    }
}

// ─────────────────────────────────────────
// ΣΤΑΤΙΣΤΙΚΑ + ΓΡΑΦΗΜΑ GENRES
// ─────────────────────────────────────────
function showStats() {
    const container = document.getElementById("stats-content");
    const active    = getActiveRatings();
    const entries   = Object.entries(active);
    const total     = Object.keys(myRatings).length;

    if (total === 0) {
        container.innerHTML = "<p class='hint'>Δεν υπάρχουν βαθμολογίες ακόμα.</p>";
        return;
    }

    const ratings     = entries.map(([, v]) => v.rating);
    const totalMovies = entries.length;
    const avgRating   = ratings.length > 0
        ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(2) : "—";
    const maxRating   = ratings.length > 0 ? Math.max(...ratings) : "—";
    const minRating   = ratings.length > 0 ? Math.min(...ratings) : "—";
    const favorite    = entries.length > 0
        ? entries.reduce((best, [, v]) => v.rating > best.rating ? v : best, entries[0][1]) : null;
    const imdbCount   = Object.values(myRatings).filter(v => v.fromIMDb).length;
    const manualCount = total - imdbCount;

    // Κατανομή βαθμολογιών
    const distribution = {};
    for (const r of ratings) distribution[r] = (distribution[r] || 0) + 1;

    const distHTML = Object.entries(distribution)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .map(([r, count]) => {
            const pct = Math.round((count / totalMovies) * 100);
            return `
                <div style="display:flex; align-items:center; gap:8px; margin:4px 0;">
                    <span style="width:40px; text-align:right; font-size:0.9rem;">${r}★</span>
                    <div style="flex:1; background:var(--border); border-radius:4px; height:16px;">
                        <div style="width:${pct}%; background:var(--primary); border-radius:4px; height:16px;"></div>
                    </div>
                    <span style="font-size:0.85rem; color:var(--text-muted);">${count} (${pct}%)</span>
                </div>
            `;
        }).join("");

    // Αγαπημένα genres — μετράμε από τα ratings
    const genreCount = {};
    for (const [movieId, v] of entries) {
        // Αναζητούμε genres από watchlist ή από τον τίτλο
        const wl = myWatchlist[movieId];
        if (wl?.genres) {
            wl.genres.split("|").forEach(g => {
                genreCount[g.trim()] = (genreCount[g.trim()] || 0) + 1;
            });
        }
    }

    const topGenres = Object.entries(genreCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);

    const maxGenreCount = topGenres.length > 0 ? topGenres[0][1] : 1;

    const genreHTML = topGenres.length > 0 ? `
        <div class="genre-bar-container">
            <strong>Αγαπημένα Genres (από Watchlist):</strong>
            <div style="margin-top:10px;">
                ${topGenres.map(([genre, count]) => `
                    <div class="genre-bar-row">
                        <span class="genre-bar-label">${genre}</span>
                        <div class="genre-bar-track">
                            <div class="genre-bar-fill" style="width:${Math.round((count/maxGenreCount)*100)}%"></div>
                        </div>
                        <span class="genre-bar-count">${count}</span>
                    </div>
                `).join("")}
            </div>
        </div>
    ` : "";

    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${totalMovies}</div>
                <div class="stat-label">Ενεργές Βαθμολογίες</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${avgRating}★</div>
                <div class="stat-label">Μέση Βαθμολογία</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${maxRating}★</div>
                <div class="stat-label">Υψηλότερη</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${minRating}★</div>
                <div class="stat-label">Χαμηλότερη</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${imdbCount}</div>
                <div class="stat-label">Από IMDb</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${manualCount}</div>
                <div class="stat-label">Χειροκίνητες</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Object.keys(myWatchlist).length}</div>
                <div class="stat-label">Watchlist</div>
            </div>
            ${favorite ? `
            <div class="stat-card">
                <div class="stat-value" style="font-size:0.95rem;">${favorite.title.substring(0,18)}...</div>
                <div class="stat-label">Αγαπημένη (${favorite.rating}★)</div>
            </div>` : ""}
        </div>

        <div style="margin-top:20px;">
            <strong>Κατανομή Βαθμολογιών:</strong>
            <div style="margin-top:10px;">${distHTML || "<p class='hint'>Καμία ενεργή βαθμολογία.</p>"}</div>
        </div>

        ${genreHTML}
    `;
}

// ─────────────────────────────────────────
// ΕΙΣΑΓΩΓΗ ΑΠΟ IMDB
// ─────────────────────────────────────────
async function importIMDb() {
    const fileInput = document.getElementById("imdb-file");
    const feedback  = document.getElementById("imdb-feedback");
    const toggleBtn = document.getElementById("toggle-imdb-btn");

    feedback.textContent = "";
    feedback.className   = "feedback-msg";

    if (!fileInput.files || fileInput.files.length === 0) {
        showToast("Παρακαλώ επίλεξε αρχείο CSV!", "error");
        return;
    }

    const file    = fileInput.files[0];
    const text    = await file.text();
    const lines   = text.split("\n").filter(l => l.trim() !== "");
    const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));

    const titleIndex  = headers.indexOf("Title");
    const ratingIndex = headers.indexOf("Your Rating");

    if (titleIndex === -1 || ratingIndex === -1) {
        showToast("Μη έγκυρο αρχείο IMDb CSV!", "error");
        return;
    }

    const imdbRatings = {};
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
        if (!cols) continue;
        const title  = cols[titleIndex]?.replace(/"/g, "").trim();
        const rating = parseFloat(cols[ratingIndex]);
        if (title && !isNaN(rating)) imdbRatings[title] = rating;
    }

    const titles = Object.keys(imdbRatings);
    feedback.textContent = `Βρέθηκαν ${titles.length} αξιολογήσεις. Αναζήτηση στη βάση...`;
    feedback.className   = "feedback-msg success";

    try {
        const res  = await fetch(`${API}/match-titles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ titles })
        });
        const data = await res.json();

        let loaded = 0;
        for (const match of data.matches) {
            const imdbRating = imdbRatings[match.imdbTitle];
            const converted  = Math.round((imdbRating / 2) * 2) / 2;
            const clamped    = Math.max(0.5, Math.min(5.0, converted));
            myRatings[match.movieId] = { title: match.movieTitle, rating: clamped, fromIMDb: true };
            loaded++;
        }

        saveToStorage();
        updateRatingsList();
        showStats();
        toggleBtn.classList.remove("hidden");
        feedback.textContent = `Εισήχθησαν ${loaded} ταινίες από τις ${titles.length}.`;
        showToast(`Εισήχθησαν ${loaded} ταινίες από IMDb!`, "success");

    } catch (err) {
        showToast("Σφάλμα σύνδεσης με τον server!", "error");
        feedback.className = "feedback-msg error";
    }
}

// ─────────────────────────────────────────
// PWA — Service Worker Registration
// ─────────────────────────────────────────
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/Movielens-app/frontend/sw.js")
            .then(reg => console.log("Service Worker registered:", reg.scope))
            .catch(err => console.log("Service Worker error:", err));
    });
}

// ─────────────────────────────────────────
// ΑΡΧΙΚΟΠΟΙΗΣΗ
// ─────────────────────────────────────────
loadTheme();
updateRatingsList();
updateWatchlist();
showStats();
renderSearchHistory();
loadDailyMovie();

const hasIMDb = Object.values(myRatings).some(v => v.fromIMDb);
if (hasIMDb) document.getElementById("toggle-imdb-btn").classList.remove("hidden");