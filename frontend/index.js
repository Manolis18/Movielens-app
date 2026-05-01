const API      = "https://movielens-backend-s49l.onrender.com/movielens/api";
const TMDB_KEY = "c862dda96952702fa0e248dc1f1f0937";
const TMDB_IMG = "https://image.tmdb.org/t/p/w92";
const PER_PAGE = 10;
let selectedMood = ""; // τρέχουσα διάθεση

// ─────────────────────────────────────────
// AUTH STATE
// ─────────────────────────────────────────
let authToken    = localStorage.getItem("authToken")    || null;
let authUsername = localStorage.getItem("authUsername") || null;
let authMode     = "login"; // "login" ή "register"

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
    history     = history.filter(h => h !== keyword);
    history.unshift(keyword);
    history     = history.slice(0, 8);
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
// TOGGLE ΦΙΛΤΡΩΝ
// ─────────────────────────────────────────
function toggleFilters() {
    const panel  = document.getElementById("filters-panel");
    const arrow  = document.getElementById("filters-arrow");
    const hidden = panel.classList.toggle("hidden");
    arrow.textContent = hidden ? "▼" : "▲";
}
// ─────────────────────────────────────────
// MOOD SELECTION
// ─────────────────────────────────────────
function selectMood(el) {
    // Αφαιρούμε selected από όλα
    document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("selected"));

    // Αν πατήσαμε το ίδιο → deselect
    if (selectedMood === el.dataset.mood) {
        selectedMood = "";
        document.getElementById("mood-selected").textContent = "";
        return;
    }

    // Επιλέγουμε νέο mood
    el.classList.add("selected");
    selectedMood = el.dataset.mood;

    // Ενημερώνουμε το genre selector αναλόγως
    const genreSelect = document.getElementById("rec-genre");
    if (selectedMood) {
        // Παίρνουμε το πρώτο genre του mood
        const primaryGenre = selectedMood.split("|")[0];
        // Βρίσκουμε αν υπάρχει στο select
        for (const opt of genreSelect.options) {
            if (opt.value === primaryGenre) {
                genreSelect.value = primaryGenre;
                break;
            }
        }
        document.getElementById("mood-selected").textContent =
            `✓ Διάθεση επιλεγμένη — ψάχνουμε για ${el.textContent.trim()}`;
    } else {
        genreSelect.value = "";
        document.getElementById("mood-selected").textContent = "";
    }
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
// TMDB — Λήψη αφίσας
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
// TMDB — Λεπτομέρειες ταινίας
// ─────────────────────────────────────────
async function fetchMovieDetails(title, year) {
    try {
        const query     = encodeURIComponent(cleanTitle(title));
        const yearP     = year ? `&year=${year}` : "";
        const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${query}${yearP}&language=en-US`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        if (!searchData.results?.length) return null;
        const tmdbId = searchData.results[0].id;
        const [detailsRes, creditsRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`),
            fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${TMDB_KEY}&language=en-US`)
        ]);
        const details = await detailsRes.json();
        const credits = await creditsRes.json();
        return { details, credits };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────
async function showMovieModal(movieId, title, genres) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id        = "movie-modal";
    overlay.innerHTML = `
        <div class="modal">
            <button class="modal-close" onclick="closeModal()">✕</button>
            <div class="skeleton" style="height:200px; border-radius:8px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => {
        if (e.target === overlay) closeModal();
    });

    const year = extractYear(title);
    const [tmdbData, avgRes] = await Promise.all([
        fetchMovieDetails(title, year),
        fetch(`${API}/average-ratings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ movieIds: [movieId] })
        }).then(r => r.json())
    ]);

    const info = avgRes.averages[movieId];
    const avg  = info ? `${info.avg} ★ (${info.count} ψήφοι)` : "—";
    let modalContent = "";

    if (tmdbData) {
        const { details, credits } = tmdbData;
        const poster   = details.poster_path
            ? `<img class="modal-poster" src="https://image.tmdb.org/t/p/w200${details.poster_path}" alt="Αφίσα">`
            : `<div class="modal-no-poster">🎬</div>`;
        const director  = credits.crew?.find(c => c.job === "Director")?.name || "—";
        const cast      = credits.cast?.slice(0, 6) || [];
        const runtime   = details.runtime ? `${details.runtime} λεπτά` : "—";
        const tmdbRating = details.vote_average ? `⭐ TMDB: ${details.vote_average.toFixed(1)}/10` : "";
        const castHTML  = cast.map(actor => {
            const photo = actor.profile_path
                ? `<img class="cast-photo" src="https://image.tmdb.org/t/p/w92${actor.profile_path}" alt="${actor.name}">`
                : `<div class="cast-photo" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">👤</div>`;
            return `
                <div class="cast-card">
                    ${photo}
                    <div class="cast-name">${actor.name}</div>
                    <div class="cast-char">${actor.character?.split("/")[0] || ""}</div>
                </div>
            `;
        }).join("");

        modalContent = `
            <button class="modal-close" onclick="closeModal()">✕</button>
            <div class="modal-header">
                ${poster}
                <div>
                    <div class="modal-title">${title}</div>
                    <div class="modal-meta">
                        🎭 ${genres.replace(/\|/g, " · ")}<br>
                        📅 ${year || "—"} &nbsp;|&nbsp; ⏱️ ${runtime}<br>
                        🎬 Σκηνοθέτης: ${director}<br>
                        ⭐ MovieLens: ${avg}
                    </div>
                    ${tmdbRating ? `<span class="modal-rating">${tmdbRating}</span>` : ""}
                </div>
            </div>
            ${details.overview ? `
                <div class="modal-section-title">📖 Synopsis</div>
                <div class="modal-synopsis">${details.overview}</div>
            ` : ""}
            ${cast.length > 0 ? `
                <div class="modal-section-title">🎭 Πρωταγωνιστές</div>
                <div class="cast-grid">${castHTML}</div>
            ` : ""}
            <div class="modal-actions">
                <a class="trailer-link" href="${trailerLink(title)}" target="_blank">▶ Trailer</a>
                <button class="watchlist-btn" onclick="addToWatchlist(${movieId}, '${title.replace(/'/g, "\\'")}', '${genres.replace(/'/g, "\\'")}'); closeModal();">
                    + Watchlist
                </button>
                <select class="rating-select" id="modal-rating-${movieId}">
                    <option value="">Βαθμολόγησε —</option>
                    ${[0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].map(v =>
                        `<option value="${v}">${v} ★</option>`
                    ).join("")}
                </select>
                <button onclick="rateMovie(${movieId}, '${title.replace(/'/g, "\\'")}', 'modal-rating-${movieId}')">
                    Αποθήκευση
                </button>
            </div>
        `;
    } else {
        modalContent = `
            <button class="modal-close" onclick="closeModal()">✕</button>
            <div class="modal-title">${title}</div>
            <div class="modal-meta">
                🎭 ${genres.replace(/\|/g, " · ")}<br>
                📅 ${year || "—"}<br>
                ⭐ MovieLens: ${avg}
            </div>
            <p class="hint">Δεν βρέθηκαν επιπλέον στοιχεία.</p>
            <div class="modal-actions">
                <a class="trailer-link" href="${trailerLink(title)}" target="_blank">▶ Trailer</a>
                <button class="watchlist-btn" onclick="addToWatchlist(${movieId}, '${title.replace(/'/g, "\\'")}', '${genres.replace(/'/g, "\\'")}'); closeModal();">
                    + Watchlist
                </button>
            </div>
        `;
    }
    document.querySelector("#movie-modal .modal").innerHTML = modalContent;
}

function closeModal() {
    const modal = document.getElementById("movie-modal");
    if (modal) modal.remove();
}

document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
});

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
            <td><span class="clickable-title" onclick="showMovieModal(${movie.movieId}, '${movie.title.replace(/'/g, "\\'")}', '${movie.genres.replace(/'/g, "\\'")}')">
                ${movie.title}
            </span></td>
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

        // Φίλτρο δεκαετίας
        const decade = document.getElementById("decade-filter")?.value;
        if (decade) {
            const decadeStart = parseInt(decade);
            const decadeEnd   = decadeStart + 9;
            movies = movies.filter(m => {
                const y = extractYear(m.title);
                return y && y >= decadeStart && y <= decadeEnd;
            });
        } else if (yearFrom || yearTo) {
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

        // Φίλτρο ελάχιστης βαθμολογίας
        const minRating = parseFloat(document.getElementById("min-rating-filter")?.value) || null;
        if (minRating) {
            movies = movies.filter(m => {
                const info = avgData.averages[m.movieId];
                return info && info.avg >= minRating;
            });
        }

        if (movies.length === 0) {
            showToast("Δεν βρέθηκαν ταινίες με αυτά τα φίλτρα!", "error");
            document.getElementById("search-results").classList.add("hidden");
            document.getElementById("pagination-controls").classList.add("hidden");
            return;
        }

        currentMovies   = movies;
        currentAverages = avgData.averages;
        currentPage     = 1;

        addToSearchHistory(keyword);
        sortCtrl.classList.remove("hidden");
        showToast(`Βρέθηκαν ${movies.length} ταινίες!`, "success");
        renderPage();

    } catch (err) {
        showToast("Σφάλμα σύνδεσης με τον server!", "error");
    }
}

// ─────────────────────────────────────────
// ΑΝΑΖΗΤΗΣΗ ΑΤΟΜΟΥ (TMDB)
// ─────────────────────────────────────────
async function searchByPerson() {
    const query    = document.getElementById("person-search").value.trim();
    const errorDiv = document.getElementById("search-error");

    if (!query) {
        showToast("Παρακαλώ εισάγετε όνομα!", "error");
        return;
    }

    errorDiv.textContent = "";
    showToast("Αναζήτηση ατόμου...", "info");

    try {
        const personRes  = await fetch(
            `https://api.themoviedb.org/3/search/person?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&language=en-US`
        );
        const personData = await personRes.json();

        if (!personData.results?.length) {
            showToast("Δεν βρέθηκε άτομο!", "error");
            return;
        }

        const person    = personData.results[0];
        const moviesRes = await fetch(
            `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${TMDB_KEY}&language=en-US`
        );
        const moviesData = await moviesRes.json();

        const tmdbTitles = [
            ...(moviesData.cast  || []),
            ...(moviesData.crew?.filter(c => c.job === "Director") || [])
        ]
        .filter(m => m.title && m.release_date)
        .map(m => ({
            title: m.title,
            year:  m.release_date.split("-")[0]
        }))
        .slice(0, 30);

        if (!tmdbTitles.length) {
            showToast("Δεν βρέθηκαν ταινίες!", "error");
            return;
        }

        const titles    = tmdbTitles.map(m => `${m.title} (${m.year})`);
        const matchRes  = await fetch(`${API}/match-titles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ titles })
        });
        const matchData = await matchRes.json();

        if (!matchData.matches?.length) {
            showToast("Δεν βρέθηκαν ταινίες στη βάση!", "error");
            return;
        }

        const movieIds = matchData.matches.map(m => m.movieId);
        const avgRes   = await fetch(`${API}/average-ratings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ movieIds })
        });
        const avgData = await avgRes.json();

        currentMovies   = matchData.matches.map(m => ({
            movieId: m.movieId,
            title:   m.movieTitle,
            genres:  "—"
        }));
        currentAverages = avgData.averages;
        currentPage     = 1;

        const role = person.known_for_department === "Directing" ? "Σκηνοθέτης" : "Ηθοποιός";
        showToast(`${matchData.matches.length} ταινίες του ${person.name} (${role})!`, "success");
        document.getElementById("sort-controls").classList.remove("hidden");
        renderPage();

    } catch (err) {
        showToast("Σφάλμα αναζήτησης!", "error");
    }
}

// ─────────────────────────────────────────
// ΒΑΘΜΟΛΟΓΗΣΗ
// ─────────────────────────────────────────
function rateMovie(movieId, title, selectId = null) {
    const id     = selectId || `rating-${movieId}`;
    const select = document.getElementById(id);
    if (!select) return;
    const rating = parseFloat(select.value);
    if (!rating) {
        showToast("Παρακαλώ επίλεξε βαθμολογία πρώτα!", "error");
        return;
    }
    myRatings[movieId] = { title, rating, fromIMDb: false };
    saveToStorage();
    syncRatingToServer(movieId, rating, false);
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
    syncWatchlistToServer(movieId, title, genres, "add");
    updateWatchlist();
    showToast(`Προστέθηκε: "${title}"`, "success");
}

function removeFromWatchlist(movieId) {
    delete myWatchlist[movieId];
    saveToStorage();
    syncWatchlistToServer(movieId, myWatchlist[movieId]?.title || "", myWatchlist[movieId]?.genres || "", "remove");
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
    // Mood override — αν έχει επιλεγεί mood, χρησιμοποιούμε αυτό
const genre = selectedMood || document.getElementById("rec-genre").value;
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
                <td><span class="clickable-title" onclick="showMovieModal(${rec.movieId}, '${rec.title.replace(/'/g, "\\'")}', '${rec.genres.replace(/'/g, "\\'")}')">
                    ${rec.title}
                </span></td>
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
// ΣΤΑΤΙΣΤΙΚΑ
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

    const genreCount = {};
    for (const [movieId] of entries) {
        const wl = myWatchlist[movieId];
        if (wl?.genres) {
            wl.genres.split("|").forEach(g => {
                genreCount[g.trim()] = (genreCount[g.trim()] || 0) + 1;
            });
        }
    }

    const topGenres     = Object.entries(genreCount).sort(([, a], [, b]) => b - a).slice(0, 8);
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
// ΤΑΙΝΙΑ ΤΗΣ ΗΜΕΡΑΣ
// ─────────────────────────────────────────
async function loadDailyMovie() {
    const container = document.getElementById("daily-movie-content");
    container.innerHTML = `<div class="skeleton" style="height:120px; border-radius:8px;"></div>`;

    try {
        const active     = getActiveRatings();
        const entries    = Object.entries(active);
        const genreCount = {};

        for (const [, v] of entries) {
            if (v.genres) {
                v.genres.split("|").forEach(g => {
                    genreCount[g.trim()] = (genreCount[g.trim()] || 0) + 1;
                });
            }
        }

        const topGenre = Object.entries(genreCount).sort(([, a], [, b]) => b - a)[0]?.[0] || null;
        const today    = new Date().toISOString().split("T")[0];
        const seed     = today.split("-").reduce((a, b) => parseInt(a) + parseInt(b), 0);
        const letters  = "abcdefghijklmnopqrstuvwxyz";
        const searchTerm = topGenre || letters[seed % letters.length];

        const res  = await fetch(`${API}/movies?search=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();

        if (!data.movies || data.movies.length === 0) {
            container.innerHTML = "<p class='hint'>Δεν βρέθηκε ταινία.</p>";
            return;
        }

        const seenIds  = new Set(Object.keys(active).map(Number));
        let candidates = data.movies.filter(m => !seenIds.has(m.movieId));
        if (candidates.length === 0) candidates = data.movies;

        const isRandom = container.dataset.random === "true";
        const movie    = isRandom
            ? candidates[Math.floor(Math.random() * candidates.length)]
            : candidates[seed % candidates.length];

        const year = extractYear(movie.title) || "—";

        const [poster, avgData] = await Promise.all([
            fetchPoster(movie.title, extractYear(movie.title)),
            fetch(`${API}/average-ratings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ movieIds: [movie.movieId] })
            }).then(r => r.json())
        ]);

        const info     = avgData.averages[movie.movieId];
        const avg      = info ? `${info.avg} ★ (${info.count} ψήφοι)` : "Χωρίς βαθμολογία";
        const posterEl = poster
            ? `<img src="${poster}" alt="Αφίσα">`
            : `<div class="daily-no-poster">🎬</div>`;

        const badge = topGenre
            ? `<span style="background:var(--primary); color:white; padding:2px 8px; border-radius:10px; font-size:0.8rem; margin-left:8px;">📌 Βάσει ${topGenre}</span>`
            : "";

        container.innerHTML = `
            <div class="daily-card">
                ${posterEl}
                <div class="daily-info">
                    <h3>${movie.title} ${badge}</h3>
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
                        <button onclick="randomDailyMovie()">🔀 Άλλη ταινία</button>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<p class='hint'>Σφάλμα φόρτωσης. <button onclick='loadDailyMovie()'>Δοκίμασε ξανά</button></p>`;
    }
}

function randomDailyMovie() {
    const container = document.getElementById("daily-movie-content");
    container.dataset.random = "true";
    loadDailyMovie();
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
    syncRatingToServer(match.movieId, clamped, true);

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
// AUTH FUNCTIONS
// ─────────────────────────────────────────
function openAuthModal() {
    if (authToken) {
        if (confirm(`Θέλεις να αποσυνδεθείς, ${authUsername};`)) {
            logout();
        }
        return;
    }
    const modal = document.getElementById("auth-modal");
    modal.classList.remove("hidden");
    modal.style.display = "flex";
    document.getElementById("auth-username").focus();
}

function closeAuthModal() {
    const modal = document.getElementById("auth-modal");
    modal.classList.add("hidden");
    modal.style.display = "none";
    document.getElementById("auth-error").textContent = "";
    document.getElementById("auth-username").value    = "";
    document.getElementById("auth-password").value    = "";
}

function toggleAuthMode() {
    authMode = authMode === "login" ? "register" : "login";
    document.getElementById("auth-title").textContent      = authMode === "login" ? "🔐 Σύνδεση" : "📝 Εγγραφή";
    document.getElementById("auth-submit-btn").textContent = authMode === "login" ? "Σύνδεση" : "Εγγραφή";
    document.getElementById("auth-switch-text").textContent = authMode === "login" ? "Δεν έχεις λογαριασμό;" : "Έχεις ήδη λογαριασμό;";
    document.getElementById("auth-switch-btn").textContent  = authMode === "login" ? "Εγγραφή" : "Σύνδεση";
    document.getElementById("auth-error").textContent = "";
}

async function submitAuth() {
    const username = document.getElementById("auth-username").value.trim();
    const password = document.getElementById("auth-password").value.trim();
    const errorDiv = document.getElementById("auth-error");

    errorDiv.textContent = "";

    if (!username || !password) {
        errorDiv.textContent = "Παρακαλώ συμπλήρωσε όλα τα πεδία.";
        return;
    }

    const endpoint = authMode === "login"
        ? `${API}/auth/login`
        : `${API}/auth/register`;

    try {
        const res  = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) {
            errorDiv.textContent = data.detail || "Σφάλμα σύνδεσης.";
            return;
        }

        // Αποθήκευση token
        authToken    = data.token;
        authUsername = data.username;
        localStorage.setItem("authToken",    authToken);
        localStorage.setItem("authUsername", authUsername);

        closeAuthModal();
        updateAuthUI();
        showToast(`Καλωσήρθες, ${authUsername}! 🎬`, "success");

        // Φόρτωση δεδομένων από server
        await loadUserDataFromServer();

    } catch (err) {
        errorDiv.textContent = "Σφάλμα σύνδεσης με τον server.";
    }
}

function logout() {
    authToken    = null;
    authUsername = null;
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUsername");
    updateAuthUI();
    showToast("Αποσυνδέθηκες επιτυχώς!", "info");
}

function updateAuthUI() {
    const btn      = document.getElementById("auth-btn");
    const userInfo = document.getElementById("user-info");

    if (authToken && authUsername) {
        btn.textContent = "🚪 Αποσύνδεση";
        btn.classList.add("logged-in");
        userInfo.textContent = `👤 ${authUsername}`;
        userInfo.classList.remove("hidden");
    } else {
        btn.textContent = "🔐 Σύνδεση";
        btn.classList.remove("logged-in");
        userInfo.classList.add("hidden");
    }
}

async function loadUserDataFromServer() {
    if (!authToken) return;

    try {
        // Φόρτωση ratings
        const ratingsRes  = await fetch(`${API}/user/ratings?token=${authToken}`);
        const ratingsData = await ratingsRes.json();

        if (ratingsData.status === "success") {
            for (const r of ratingsData.ratings) {
                myRatings[r.movieId] = {
                    title:    r.title,
                    rating:   r.rating,
                    fromIMDb: r.fromIMDb === 1
                };
            }
        }

        // Φόρτωση watchlist
        const watchRes  = await fetch(`${API}/user/watchlist?token=${authToken}`);
        const watchData = await watchRes.json();

        if (watchData.status === "success") {
            for (const w of watchData.watchlist) {
                myWatchlist[w.movieId] = { title: w.title, genres: w.genres };
            }
        }

        saveToStorage();
        updateRatingsList();
        updateWatchlist();
        showStats();
        showToast("Τα δεδομένα σου φορτώθηκαν!", "success");

    } catch (err) {
        showToast("Σφάλμα φόρτωσης δεδομένων!", "error");
    }
}

async function syncRatingToServer(movieId, rating, fromIMDb = false) {
    if (!authToken) return;
    try {
        await fetch(`${API}/user/ratings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: authToken, movieId, rating, fromIMDb })
        });
    } catch { }
}

async function syncWatchlistToServer(movieId, title, genres, action) {
    if (!authToken) return;
    try {
        await fetch(`${API}/user/watchlist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: authToken, movieId, title, genres, action })
        });
    } catch { }
}

// ─────────────────────────────────────────
// ΚΟΙΝΕΣ ΤΑΙΝΙΕΣ ΜΕ ΦΙΛΟ
// ─────────────────────────────────────────
async function compareWithFriend() {
    const friend   = document.getElementById("friend-username").value.trim();
    const errorDiv = document.getElementById("compare-error");
    const results  = document.getElementById("compare-results");

    errorDiv.textContent = "";
    results.innerHTML    = "";

    if (!authToken) {
        showToast("Πρέπει να είσαι συνδεδεμένος!", "error");
        return;
    }

    if (!friend) {
        showToast("Παρακαλώ εισάγετε username φίλου!", "error");
        return;
    }

    if (friend === authUsername) {
        showToast("Δεν μπορείς να συγκριθείς με τον εαυτό σου!", "error");
        return;
    }

    results.innerHTML = `<div class="skeleton" style="height:100px; border-radius:8px; margin-top:12px;"></div>`;

    try {
        const res  = await fetch(`${API}/user/compare?token=${authToken}&friend=${encodeURIComponent(friend)}`);
        const data = await res.json();

        if (!res.ok) {
            errorDiv.textContent = data.detail || "Σφάλμα σύγκρισης.";
            results.innerHTML    = "";
            return;
        }

        if (data.commonCount === 0) {
            results.innerHTML = `<p class="hint" style="margin-top:12px;">Δεν έχετε κοινές ταινίες με τον ${friend} ακόμα!</p>`;
            return;
        }

        // Compatibility score
        const compatibility = Math.round((data.agreedCount / data.commonCount) * 100);
        const compatEmoji   = compatibility >= 70 ? "🔥" : compatibility >= 40 ? "👍" : "🤔";

        let html = `
            <div class="compare-stats">
                <div class="compare-stat-card">
                    <div class="value">${data.commonCount}</div>
                    <div class="label">Κοινές Ταινίες</div>
                </div>
                <div class="compare-stat-card">
                    <div class="value">${compatibility}% ${compatEmoji}</div>
                    <div class="label">Συμβατότητα</div>
                </div>
                <div class="compare-stat-card">
                    <div class="value">${data.myAvg}★</div>
                    <div class="label">Μέσος Όρος σου</div>
                </div>
                <div class="compare-stat-card">
                    <div class="value">${data.friendAvg}★</div>
                    <div class="label">Μέσος Όρος ${data.friendName}</div>
                </div>
            </div>
        `;

        // Ταινίες που συμφωνείτε
        if (data.agreedCount > 0) {
            html += `<div class="compare-section-title">✅ Ταινίες που Συμφωνείτε (${data.agreedCount})</div>`;
            const agreed = data.common.filter(r => Math.abs(r.myRating - r.friendRating) <= 0.5).slice(0, 5);
            html += agreed.map(r => `
                <div class="compare-movie-row">
                    <span class="compare-movie-title">${r.title}</span>
                    <span class="rating-badge mine">${r.myRating}★</span>
                    <span class="rating-badge friend">${r.friendRating}★</span>
                    <span class="rating-badge agree">✓</span>
                </div>
            `).join("");
        }

        // Ταινίες που διαφωνείτε
        if (data.disagreed.length > 0) {
            html += `<div class="compare-section-title">❌ Μεγαλύτερες Διαφωνίες</div>`;
            html += data.disagreed.map(r => `
                <div class="compare-movie-row">
                    <span class="compare-movie-title">${r.title}</span>
                    <span class="rating-badge mine">${r.myRating}★</span>
                    <span class="rating-badge friend">${r.friendRating}★</span>
                    <span class="rating-badge disagree">Δ${Math.abs(r.myRating - r.friendRating).toFixed(1)}</span>
                </div>
            `).join("");
        }

        // Όλες οι κοινές
        html += `<div class="compare-section-title">🎬 Όλες οι Κοινές Ταινίες</div>`;
        html += data.common.map(r => `
            <div class="compare-movie-row">
                <span class="compare-movie-title">${r.title}</span>
                <span class="rating-badge mine">${r.myRating}★ εσύ</span>
                <span class="rating-badge friend">${r.friendRating}★ ${data.friendName}</span>
            </div>
        `).join("");

        results.innerHTML = html;

    } catch (err) {
        results.innerHTML    = "";
        errorDiv.textContent = "Σφάλμα σύνδεσης με τον server.";
    }
}

// ─────────────────────────────────────────
// ΕΞΑΓΩΓΗ ΠΡΟΦΙΛ ΩΣ ΕΙΚΟΝΑ
// ─────────────────────────────────────────
function exportProfileImage() {
    const active    = getActiveRatings();
    const entries   = Object.entries(active);
    const total     = Object.keys(myRatings).length;

    if (total === 0) {
        showToast("Δεν υπάρχουν βαθμολογίες για εξαγωγή!", "error");
        return;
    }

    const canvas  = document.getElementById("profile-canvas");
    const ctx     = canvas.getContext("2d");
    const isDark  = document.documentElement.getAttribute("data-theme") === "dark";

    // Διαστάσεις
    canvas.width  = 600;
    canvas.height = 400;

    // Χρώματα
    const bg      = isDark ? "#1e1e2e" : "#ffffff";
    const primary = isDark ? "#7c83fd" : "#1a1a2e";
    const text    = isDark ? "#e0e0e0" : "#333333";
    const muted   = isDark ? "#aaaaaa" : "#666666";
    const border  = isDark ? "#333355" : "#e0e0e0";

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 600, 400);

    // Header
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, 600, 80);

    // Logo text
    ctx.fillStyle = "#ffffff";
    ctx.font      = "bold 28px Arial";
    ctx.fillText("🎬 MovieLens Explorer", 24, 42);

    // Username
    const displayName = authUsername || "Επισκέπτης";
    ctx.font      = "16px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(`👤 ${displayName}`, 24, 65);

    // Στατιστικά
    const ratings   = entries.map(([, v]) => v.rating);
    const avgRating = ratings.length > 0
        ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : "—";
    const maxRating = ratings.length > 0 ? Math.max(...ratings) : "—";
    const imdbCount = Object.values(myRatings).filter(v => v.fromIMDb).length;
    const watchCount = Object.keys(myWatchlist).length;
    const favorite  = entries.length > 0
        ? entries.reduce((best, [, v]) => v.rating > best.rating ? v : best, entries[0][1]) : null;

    // Stat cards
    const stats = [
        { label: "Βαθμολογίες",   value: total },
        { label: "Μέσος Όρος",    value: `${avgRating}★` },
        { label: "Υψηλότερη",     value: `${maxRating}★` },
        { label: "Από IMDb",      value: imdbCount },
        { label: "Watchlist",     value: watchCount },
    ];

    const cardW = 100;
    const cardH = 80;
    const startX = 24;
    const startY = 100;

    stats.forEach((stat, i) => {
        const x = startX + i * (cardW + 12);
        const y = startY;

        // Card background
        ctx.fillStyle = border;
        ctx.beginPath();
        ctx.roundRect(x, y, cardW, cardH, 8);
        ctx.fill();

        // Value
        ctx.fillStyle = primary;
        ctx.font      = "bold 22px Arial";
        ctx.textAlign = "center";
        ctx.fillText(stat.value, x + cardW/2, y + 35);

        // Label
        ctx.fillStyle = muted;
        ctx.font      = "11px Arial";
        ctx.fillText(stat.label, x + cardW/2, y + 55);
    });

    ctx.textAlign = "left";

    // Κατανομή βαθμολογιών
    ctx.fillStyle = text;
    ctx.font      = "bold 14px Arial";
    ctx.fillText("Κατανομή Βαθμολογιών", 24, 220);

    const distribution = {};
    for (const r of ratings) distribution[r] = (distribution[r] || 0) + 1;
    const topRatings = Object.entries(distribution)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .slice(0, 6);

    topRatings.forEach(([r, count], i) => {
        const y   = 235 + i * 22;
        const pct = ratings.length > 0 ? count / ratings.length : 0;
        const barW = Math.round(pct * 300);

        ctx.fillStyle = muted;
        ctx.font      = "12px Arial";
        ctx.fillText(`${r}★`, 24, y + 12);

        ctx.fillStyle = border;
        ctx.fillRect(60, y, 300, 14);

        ctx.fillStyle = primary;
        ctx.fillRect(60, y, barW, 14);

        ctx.fillStyle = muted;
        ctx.font      = "11px Arial";
        ctx.fillText(`${count}`, 370, y + 12);
    });

    // Αγαπημένη ταινία
    if (favorite) {
        ctx.fillStyle = text;
        ctx.font      = "bold 14px Arial";
        ctx.fillText("Αγαπημένη Ταινία", 24, 380);
        ctx.font      = "12px Arial";
        ctx.fillStyle = primary;
        const favTitle = favorite.title.length > 40
            ? favorite.title.substring(0, 40) + "..."
            : favorite.title;
        ctx.fillText(`${favTitle} (${favorite.rating}★)`, 24, 396);
    }

    // Footer
    ctx.fillStyle = muted;
    ctx.font      = "11px Arial";
    ctx.textAlign = "right";
    ctx.fillText("manolis18.github.io/Movielens-app/frontend", 576, 396);

    // Download
    const link    = document.createElement("a");
    link.download = `movielens-profile-${displayName}.png`;
    link.href     = canvas.toDataURL("image/png");
    link.click();

    showToast("Το προφίλ σου εξήχθη επιτυχώς!", "success");
}

// ─────────────────────────────────────────
// AI CHAT ASSISTANT
// ─────────────────────────────────────────
let chatHistory = [];

function setChatInput(text) {
    document.getElementById("chat-input").value = text;
    document.getElementById("chat-input").focus();
}

function addChatMessage(role, content, movies = []) {
    const container = document.getElementById("chat-messages");
    const div       = document.createElement("div");
    div.className   = `chat-message ${role}`;

    const avatar = role === "user" ? "👤" : "🤖";

    let moviesHTML = "";
    if (movies.length > 0) {
        moviesHTML = `
            <div class="chat-movie-suggestions">
                ${movies.map(m => `
                    <div class="chat-movie-card" onclick="showMovieModal(${m.movieId}, '${m.title.replace(/'/g, "\\'")}', '${m.genres.replace(/'/g, "\\'")}')">
                        <div>
                            <div class="chat-movie-title">${m.title}</div>
                            <div class="chat-movie-genre">${m.genres.replace(/\|/g, " · ")}</div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="watchlist-btn" style="font-size:0.75rem; padding:3px 8px;"
                                onclick="event.stopPropagation(); addToWatchlist(${m.movieId}, '${m.title.replace(/'/g, "\\'")}', '${m.genres.replace(/'/g, "\\'")}')">
                                + Watchlist
                            </button>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
    }

    div.innerHTML = `
        <div class="chat-avatar">${avatar}</div>
        <div class="chat-bubble">
            ${content}
            ${moviesHTML}
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addTypingIndicator() {
    const container = document.getElementById("chat-messages");
    const div       = document.createElement("div");
    div.className   = "chat-message";
    div.id          = "typing-indicator";
    div.innerHTML   = `
        <div class="chat-avatar">🤖</div>
        <div class="chat-bubble">
            <div class="chat-typing">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById("typing-indicator");
    if (el) el.remove();
}

async function sendChatMessage() {
    const input   = document.getElementById("chat-input");
    const btn     = document.getElementById("chat-send-btn");
    const message = input.value.trim();

    if (!message) return;

    input.value  = "";
    btn.disabled = true;

    addChatMessage("user", message);
    addTypingIndicator();

    const active    = getActiveRatings();
    const entries   = Object.entries(active);
    const topRated  = entries
        .sort(([, a], [, b]) => b.rating - a.rating)
        .slice(0, 10)
        .map(([, v]) => `${v.title} (${v.rating}★)`)
        .join(", ");

    chatHistory.push({ role: "user", content: message });

    try {
        const res  = await fetch(`${API}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages:      chatHistory,
                system:        "",
                top_ratings:   topRated,
                total_ratings: entries.length
            })
        });

        const data   = await res.json();
        const aiText = data.text || "Συγγνώμη, δεν μπόρεσα να απαντήσω.";

        chatHistory.push({ role: "assistant", content: aiText });

        // Εξάγουμε JSON ταινιών
        const jsonMatch = aiText.match(/MOVIES_JSON:(\[.*?\])/s);
        let movies      = [];

        if (jsonMatch) {
            try {
                const suggested = JSON.parse(jsonMatch[1]);
                for (const s of suggested) {
                    const r = await fetch(`${API}/movies?search=${encodeURIComponent(s.title)}`);
                    const d = await r.json();
                    if (d.movies?.length > 0) {
                        const match = d.movies.find(m => {
                            const y = extractYear(m.title);
                            return Math.abs((y || 0) - (s.year || 0)) <= 2;
                        }) || d.movies[0];
                        movies.push(match);
                    }
                }
            } catch { }
        }

        const cleanText = aiText.replace(/MOVIES_JSON:\[.*?\]/s, "").trim();

        removeTypingIndicator();
        addChatMessage("assistant", cleanText, movies);

    } catch (err) {
        removeTypingIndicator();
        addChatMessage("assistant", "Συγγνώμη, υπήρξε πρόβλημα. Δοκίμασε ξανά!");
    }

    btn.disabled = false;
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

updateAuthUI();
if (authToken) loadUserDataFromServer();