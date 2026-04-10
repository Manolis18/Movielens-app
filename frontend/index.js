const API       = "http://localhost:3000/movielens/api";
const TMDB_KEY  = "c862dda96952702fa0e248dc1f1f0937";
const TMDB_IMG  = "https://image.tmdb.org/t/p/w92";
const PER_PAGE  = 10;

// ─────────────────────────────────────────
// ΚΑΤΑΣΤΑΣΗ ΕΦΑΡΜΟΓΗΣ
// ─────────────────────────────────────────
let currentMovies    = [];
let currentAverages  = {};
let currentPage      = 1;
let posterCache      = {};
let imdbHidden       = false; // κατάσταση απόκρυψης IMDb ratings

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
    const query = encodeURIComponent(title + " trailer");
    return `https://www.youtube.com/results?search_query=${query}`;
}

// Επιστρέφει μόνο τα ενεργά ratings (εξαιρεί IMDb αν είναι κρυμμένα)
function getActiveRatings() {
    if (!imdbHidden) return myRatings;
    const active = {};
    for (const [id, v] of Object.entries(myRatings)) {
        if (!v.fromIMDb) active[id] = v;
    }
    return active;
}

// ─────────────────────────────────────────
// TOGGLE IMDB RATINGS
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
// TMDB — Λήψη αφίσας
// ─────────────────────────────────────────
async function fetchPoster(title, year) {
    const key = `${title}_${year}`;
    if (posterCache[key] !== undefined) return posterCache[key];

    try {
        const query     = encodeURIComponent(cleanTitle(title));
        const yearParam = year ? `&year=${year}` : "";
        const url       = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${query}${yearParam}&language=en-US`;
        const res       = await fetch(url);
        const data      = await res.json();

        if (data.results && data.results.length > 0 && data.results[0].poster_path) {
            const path = TMDB_IMG + data.results[0].poster_path;
            posterCache[key] = path;
            return path;
        }
    } catch {
        // αν αποτύχει επιστρέφουμε null
    }

    posterCache[key] = null;
    return null;
}

async function posterHTML(title) {
    const year = extractYear(title);
    const src  = await fetchPoster(title, year);
    if (src) {
        return `<img class="movie-poster" src="${src}" alt="Αφίσα" loading="lazy">`;
    }
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
        } else if (field === "avg") {
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
    const totalPages = Math.ceil(currentMovies.length / PER_PAGE);
    currentPage = Math.max(1, Math.min(currentPage + delta, totalPages));
    renderPage();
}

async function renderPage() {
    const tbody      = document.getElementById("search-results-body");
    const table      = document.getElementById("search-results");
    const pagination = document.getElementById("pagination-controls");
    const pageInfo   = document.getElementById("page-info");

    const totalPages = Math.ceil(currentMovies.length / PER_PAGE);
    const start      = (currentPage - 1) * PER_PAGE;
    const pageMovies = currentMovies.slice(start, start + PER_PAGE);

    tbody.innerHTML = "";

    for (const movie of pageMovies) {
        const info   = currentAverages[movie.movieId];
        const avg    = info ? `${info.avg} ★ (${info.count} ψήφοι)` : "—";
        const year   = extractYear(movie.title) || "—";
        const poster = await posterHTML(movie.title);

        const tr = document.createElement("tr");
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
                    <button onclick="rateMovie(${movie.movieId}, '${movie.title.replace(/'/g, "\\'")}')">
                        Αποθήκευση
                    </button>
                    <a class="trailer-link" href="${trailerLink(movie.title)}" target="_blank">
                        ▶ Trailer
                    </a>
                    <button class="watchlist-btn" onclick="addToWatchlist(${movie.movieId}, '${movie.title.replace(/'/g, "\\'")}', '${movie.genres.replace(/'/g, "\\'")}')">
                        + Watchlist
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    }

    // Στήλη αφίσας στο header
    const thead = document.querySelector("#search-results thead tr");
    if (thead && thead.children[0].textContent !== "Αφίσα") {
        const th = document.createElement("th");
        th.textContent = "Αφίσα";
        thead.insertBefore(th, thead.children[0]);
    }

    table.classList.remove("hidden");
    pageInfo.textContent = `Σελίδα ${currentPage} από ${totalPages} (${currentMovies.length} ταινίες)`;
    pagination.classList.remove("hidden");
}

// ─────────────────────────────────────────
// ΑΝΑΖΗΤΗΣΗ ΤΑΙΝΙΩΝ
// ─────────────────────────────────────────
async function searchMovies() {
    const keyword  = document.getElementById("search-input").value.trim();
    const yearFrom = parseInt(document.getElementById("year-from").value) || null;
    const yearTo   = parseInt(document.getElementById("year-to").value)   || null;
    const errorDiv = document.getElementById("search-error");
    const sortCtrl = document.getElementById("sort-controls");

    errorDiv.textContent = "";

    if (!keyword) {
        errorDiv.textContent = "Παρακαλώ εισάγετε μια λέξη-κλειδί για αναζήτηση.";
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
            errorDiv.textContent = "Δεν βρέθηκαν ταινίες με αυτά τα κριτήρια.";
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

        sortCtrl.classList.remove("hidden");
        renderPage();

    } catch (err) {
        errorDiv.textContent = "Σφάλμα σύνδεσης με τον server.";
    }
}

// ─────────────────────────────────────────
// ΒΑΘΜΟΛΟΓΗΣΗ
// ─────────────────────────────────────────
function rateMovie(movieId, title) {
    const select = document.getElementById(`rating-${movieId}`);
    const rating = parseFloat(select.value);

    if (!rating) {
        alert("Παρακαλώ επίλεξε βαθμολογία πρώτα.");
        return;
    }

    // Χειροκίνητη βαθμολογία — fromIMDb: false
    myRatings[movieId] = { title, rating, fromIMDb: false };
    saveToStorage();
    updateRatingsList();
    alert(`Αποθηκεύτηκε: "${title}" → ${rating} ★`);
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
    if (hidden > 0) {
        html += ` <span style="color:var(--text-muted); font-size:0.85rem;">(${hidden} IMDb κρυμμένες)</span>`;
    }
    html += "<br>";

    if (entries.length === 0) {
        html += "<span style='color:var(--text-muted); font-size:0.9rem;'>Όλες οι βαθμολογίες είναι κρυμμένες.</span>";
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
        alert(`"${title}" υπάρχει ήδη στη Watchlist σου!`);
        return;
    }
    myWatchlist[movieId] = { title, genres };
    saveToStorage();
    updateWatchlist();
    alert(`Προστέθηκε στη Watchlist: "${title}"`);
}

function removeFromWatchlist(movieId) {
    delete myWatchlist[movieId];
    saveToStorage();
    updateWatchlist();
}

function clearWatchlist() {
    if (!confirm("Σίγουρα θέλεις να διαγράψεις ολόκληρη τη Watchlist;")) return;
    myWatchlist = {};
    saveToStorage();
    updateWatchlist();
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
            <td>
                <a class="trailer-link" href="${trailerLink(m.title)}" target="_blank">
                    ▶ Trailer
                </a>
            </td>
            <td>
                <button class="remove-btn" onclick="removeFromWatchlist(${movieId})">
                    Αφαίρεση
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    }
}

function exportWatchlist() {
    const entries = Object.entries(myWatchlist);
    if (entries.length === 0) {
        alert("Η Watchlist σου είναι άδεια!");
        return;
    }

    const header = "Τίτλος,Είδος,Trailer\n";
    const rows   = entries.map(([, m]) => {
        const link = trailerLink(m.title);
        return `"${m.title}","${m.genres}","${link}"`;
    }).join("\n");

    const csv  = header + rows;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "watchlist.csv";
    a.click();
    URL.revokeObjectURL(url);
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
        feedback.textContent = "Παρακαλώ συμπλήρωσε τίτλο και είδος.";
        feedback.classList.add("error");
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
            feedback.textContent = `Η ταινία προστέθηκε με ID: ${data.movieId}`;
            feedback.classList.add("success");
            document.getElementById("add-title").value  = "";
            document.getElementById("add-genres").value = "";
        } else {
            feedback.textContent = "Κάτι πήγε στραβά. Δοκίμασε ξανά.";
            feedback.classList.add("error");
        }
    } catch (err) {
        feedback.textContent = "Σφάλμα σύνδεσης με τον server.";
        feedback.classList.add("error");
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

    errorDiv.textContent = "";

    // Χρησιμοποιούμε μόνο τα ενεργά ratings
    const active  = getActiveRatings();
    const entries = Object.entries(active);

    if (entries.length < 2) {
        errorDiv.textContent = "Χρειάζονται τουλάχιστον 2 ενεργές βαθμολογίες για προτάσεις.";
        return;
    }

    const ratingsPayload = entries.map(([movieId, v]) => ({
        movieId: parseInt(movieId),
        rating:  v.rating
    }));

    try {
        const res  = await fetch(`${API}/recommendations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
            errorDiv.textContent = "Δεν βρέθηκαν προτάσεις με αυτά τα κριτήρια.";
            table.classList.add("hidden");
            return;
        }

        tbody.innerHTML = "";

        const thead = document.querySelector("#rec-results thead tr");
        if (thead && thead.children[0].textContent !== "Αφίσα") {
            const th = document.createElement("th");
            th.textContent = "Αφίσα";
            thead.insertBefore(th, thead.children[0]);
        }

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
                        <a class="trailer-link" href="${trailerLink(rec.title)}" target="_blank">
                            ▶ Trailer
                        </a>
                        <button class="watchlist-btn" onclick="addToWatchlist(${rec.movieId}, '${rec.title.replace(/'/g, "\\'")}', '${rec.genres.replace(/'/g, "\\'")}')">
                            + Watchlist
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }

        table.classList.remove("hidden");

    } catch (err) {
        errorDiv.textContent = "Σφάλμα σύνδεσης με τον server.";
    }
}

// ─────────────────────────────────────────
// ΣΤΑΤΙΣΤΙΚΑ ΧΡΗΣΤΗ
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
        ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(2)
        : "—";
    const maxRating   = ratings.length > 0 ? Math.max(...ratings) : "—";
    const minRating   = ratings.length > 0 ? Math.min(...ratings) : "—";
    const favorite    = entries.length > 0
        ? entries.reduce((best, [, v]) => v.rating > best.rating ? v : best, entries[0][1])
        : null;

    const imdbCount   = Object.values(myRatings).filter(v => v.fromIMDb).length;
    const manualCount = total - imdbCount;

    const distribution = {};
    for (const r of ratings) {
        distribution[r] = (distribution[r] || 0) + 1;
    }

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
                <div class="stat-label">Υψηλότερη Βαθμολογία</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${minRating}★</div>
                <div class="stat-label">Χαμηλότερη Βαθμολογία</div>
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
            <strong>Κατανομή Βαθμολογιών${imdbHidden ? " (χωρίς IMDb)" : ""}:</strong>
            <div style="margin-top:10px;">${distHTML || "<p class='hint'>Καμία ενεργή βαθμολογία.</p>"}</div>
        </div>
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
        feedback.textContent = "Παρακαλώ επίλεξε το CSV αρχείο από το IMDb.";
        feedback.classList.add("error");
        return;
    }

    const file = fileInput.files[0];
    const text = await file.text();

    const lines   = text.split("\n").filter(l => l.trim() !== "");
    const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));

    const titleIndex  = headers.indexOf("Title");
    const ratingIndex = headers.indexOf("Your Rating");

    if (titleIndex === -1 || ratingIndex === -1) {
        feedback.textContent = "Μη έγκυρο αρχείο IMDb CSV.";
        feedback.classList.add("error");
        return;
    }

    const imdbRatings = {};
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
        if (!cols) continue;
        const title  = cols[titleIndex]?.replace(/"/g, "").trim();
        const rating = parseFloat(cols[ratingIndex]);
        if (title && !isNaN(rating)) {
            imdbRatings[title] = rating;
        }
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
            myRatings[match.movieId] = {
                title:    match.movieTitle,
                rating:   clamped,
                fromIMDb: true          // ← σημειώνουμε ότι ήρθε από IMDb
            };
            loaded++;
        }

        saveToStorage();
        updateRatingsList();
        showStats();

        // Εμφανίζουμε το κουμπί απόκρυψης
        toggleBtn.classList.remove("hidden");

        feedback.textContent = `Εισήχθησαν ${loaded} ταινίες από τις ${titles.length}.`;

    } catch (err) {
        feedback.textContent = "Σφάλμα σύνδεσης με τον server.";
        feedback.className   = "feedback-msg error";
    }
}

// ─────────────────────────────────────────
// ΑΡΧΙΚΟΠΟΙΗΣΗ
// ─────────────────────────────────────────
loadTheme();
updateRatingsList();
updateWatchlist();
showStats();

// Αν υπάρχουν ήδη IMDb ratings από προηγούμενη session, εμφάνισε το κουμπί
const hasIMDb = Object.values(myRatings).some(v => v.fromIMDb);
if (hasIMDb) {
    document.getElementById("toggle-imdb-btn").classList.remove("hidden");
}