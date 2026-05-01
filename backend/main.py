from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import os
import random
from typing import List
from scipy.stats import pearsonr
import numpy as np
import hashlib
import secrets
from scipy.sparse.linalg import svds
from scipy.sparse import csr_matrix
import numpy as np

# ─────────────────────────────────────────
# ΑΡΧΙΚΟΠΟΙΗΣΗ APP
# ─────────────────────────────────────────
app = FastAPI()

# CORS: επιτρέπουμε στο frontend να μιλάει με τον server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Διαδρομή βάσης δεδομένων
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "movielens.db")

# Βοηθητική συνάρτηση για σύνδεση με τη βάση
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # επιστρέφει dict αντί για tuple
    return conn

# ─────────────────────────────────────────
# ENDPOINT 1: Αναζήτηση ταινιών
# GET /movielens/api/movies?search=keyword
# ─────────────────────────────────────────
@app.get("/movielens/api/movies")
def search_movies(search: str = ""):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM movies WHERE LOWER(title) LIKE LOWER(?)",
        (f"%{search}%",)
    )
    movies = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "success", "movies": movies}

# ─────────────────────────────────────────
# ENDPOINT 2: Ratings μιας ταινίας
# GET /movielens/api/ratings/{movieId}
# ─────────────────────────────────────────
@app.get("/movielens/api/ratings/{movieId}")
def get_ratings(movieId: int):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM ratings WHERE movieId = ?",
        (movieId,)
    )
    ratings = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "success", "ratings": ratings}

# ─────────────────────────────────────────
# ENDPOINT 3: Προσθήκη νέας ταινίας
# POST /movielens/api/movies
# ─────────────────────────────────────────
class NewMovie(BaseModel):
    title: str
    genres: str

@app.post("/movielens/api/movies")
def add_movie(movie: NewMovie):
    conn = get_conn()
    cursor = conn.cursor()
    # Βρίσκουμε το μεγαλύτερο υπάρχον movieId και προσθέτουμε 1
    cursor.execute("SELECT MAX(movieId) FROM movies")
    max_id = cursor.fetchone()[0] or 0
    new_id = max_id + 1
    cursor.execute(
        "INSERT INTO movies (movieId, title, genres) VALUES (?, ?, ?)",
        (new_id, movie.title, movie.genres)
    )
    conn.commit()
    conn.close()
    return {"status": "success", "movieId": new_id}

# ─────────────────────────────────────────
# ENDPOINT 4: Συστάσεις ταινιών
# POST /movielens/api/recommendations
# ─────────────────────────────────────────
class RatingItem(BaseModel):
    movieId: int
    rating: float

class RecommendationRequest(BaseModel):
    ratings: List[RatingItem]
    genres: str = ""        # προαιρετικό φίλτρο genre, π.χ. "Action"
    exclude_seen: bool = True  # αποκλεισμός ταινιών που έχει δει ο χρήστης
    n: int = 10             # πόσες προτάσεις θέλουμε

@app.post("/movielens/api/recommendations")
def get_recommendations(request: RecommendationRequest):

    user_ratings = {r.movieId: r.rating for r in request.ratings}
    top_rated    = sorted(user_ratings.items(), key=lambda x: x[1], reverse=True)[:30]
    rated_movies = set(dict(top_rated).keys())
    user_ratings = dict(top_rated)

    conn   = get_conn()
    cursor = conn.cursor()

    # ─────────────────────────────────────────
    # ΦΟΡΤΩΣΗ ΔΕΔΟΜΕΝΩΝ ΓΙΑ SVD
    # ─────────────────────────────────────────

    # Βρίσκουμε χρήστες που έχουν δει κοινές ταινίες
    placeholders = ",".join("?" * len(rated_movies))
    cursor.execute(
        f"SELECT DISTINCT userId FROM ratings WHERE movieId IN ({placeholders})",
        list(rated_movies)
    )
    candidate_users = [row["userId"] for row in cursor.fetchall()]

    if len(candidate_users) < 5:
        conn.close()
        return {"status": "success", "recommendations": []}

    # Φορτώνουμε ratings των candidate users
    cursor.execute(
        f"""
        SELECT userId, movieId, rating 
        FROM ratings 
        WHERE userId IN ({','.join('?' * len(candidate_users))})
        """,
        candidate_users
    )
    all_ratings = cursor.fetchall()

    # ─────────────────────────────────────────
    # ΚΑΤΑΣΚΕΥΗ MATRIX
    # ─────────────────────────────────────────

    # Δημιουργούμε mappings userId/movieId → index
    user_ids  = list(set(r["userId"]  for r in all_ratings))
    movie_ids = list(set(r["movieId"] for r in all_ratings))

    user_idx  = {u: i for i, u in enumerate(user_ids)}
    movie_idx = {m: i for i, m in enumerate(movie_ids)}

    # Προσθέτουμε τον νέο χρήστη (u) στο τέλος
    new_user_idx = len(user_ids)

    # Φτιάχνουμε sparse matrix
    rows, cols, vals = [], [], []
    for r in all_ratings:
        rows.append(user_idx[r["userId"]])
        cols.append(movie_idx[r["movieId"]])
        vals.append(r["rating"])

    # Προσθέτουμε ratings νέου χρήστη
    for movie_id, rating in user_ratings.items():
        if movie_id in movie_idx:
            rows.append(new_user_idx)
            cols.append(movie_idx[movie_id])
            vals.append(rating)

    n_users  = new_user_idx + 1
    n_movies = len(movie_ids)

    matrix = csr_matrix(
        (vals, (rows, cols)),
        shape=(n_users, n_movies)
    )

    # ─────────────────────────────────────────
    # SVD ΥΠΟΛΟΓΙΣΜΟΣ
    # ─────────────────────────────────────────

    # Αφαιρούμε μέσο όρο ανά χρήστη (mean-centering)
    matrix_dense = matrix.toarray().astype(float)
    user_means   = np.zeros(n_users)

    for i in range(n_users):
        row = matrix_dense[i]
        nonzero = row[row != 0]
        if len(nonzero) > 0:
            user_means[i] = nonzero.mean()
            row[row != 0] -= user_means[i]

    # SVD με k=20 latent factors
    k = min(20, min(n_users, n_movies) - 1)
    try:
        U, sigma, Vt = svds(csr_matrix(matrix_dense), k=k)
    except Exception:
        conn.close()
        return {"status": "success", "recommendations": []}

    # Ανακατασκευή matrix με προβλέψεις
    sigma_diag    = np.diag(sigma)
    predicted_all = np.dot(np.dot(U, sigma_diag), Vt)

    # Επαναφέρουμε μέσο όρο
    predicted_all += user_means.reshape(-1, 1)

    # Παίρνουμε προβλέψεις για τον νέο χρήστη
    new_user_preds = predicted_all[new_user_idx]

    # ─────────────────────────────────────────
    # ΦΙΛΤΡΑΡΙΣΜΑ & ΕΠΙΛΟΓΗ TOP-N
    # ─────────────────────────────────────────

    # Αντίστροφο mapping index → movieId
    idx_to_movie = {i: m for m, i in movie_idx.items()}

    # Αποκλείουμε ταινίες που έχει ήδη δει
    predictions = []
    for idx, pred in enumerate(new_user_preds):
        movie_id = idx_to_movie.get(idx)
        if movie_id and movie_id not in rated_movies:
            noise    = random.uniform(-0.1, 0.1)
            pred_val = max(0.5, min(5.0, float(pred) + noise))
            predictions.append((movie_id, pred_val))

    # Φιλτράρισμα ανά genre
    if request.genres:
        cursor.execute(
            "SELECT movieId FROM movies WHERE LOWER(genres) LIKE LOWER(?)",
            (f"%{request.genres}%",)
        )
        genre_ids  = {row["movieId"] for row in cursor.fetchall()}
        predictions = [(m, p) for m, p in predictions if m in genre_ids]

    # Top-N
    predictions.sort(key=lambda x: x[1], reverse=True)
    top_n = predictions[:request.n]

    # Φέρνουμε στοιχεία ταινιών
    recommendations = []
    for movie_id, pred_rating in top_n:
        cursor.execute("SELECT * FROM movies WHERE movieId = ?", (movie_id,))
        row = cursor.fetchone()
        if row:
            recommendations.append({
                "movieId":         row["movieId"],
                "title":           row["title"],
                "genres":          row["genres"],
                "predictedRating": round(pred_rating, 2)
            })

    conn.close()
    return {"status": "success", "recommendations": recommendations}
# ─────────────────────────────────────────
# ENDPOINT 5: Αντιστοίχιση τίτλων IMDb
# POST /movielens/api/match-titles
# ─────────────────────────────────────────
class TitleMatchRequest(BaseModel):
    titles: List[str]

@app.post("/movielens/api/match-titles")
def match_titles(request: TitleMatchRequest):
    conn = get_conn()
    cursor = conn.cursor()
    matches = []

    for title in request.titles:
        # Αφαιρούμε το έτος από τον τίτλο αν υπάρχει π.χ. "The Matrix (1999)"
        clean = title.strip()
        cursor.execute(
            "SELECT movieId, title FROM movies WHERE LOWER(title) LIKE LOWER(?)",
            (f"%{clean}%",)
        )
        row = cursor.fetchone()
        if row:
            matches.append({
                "imdbTitle": title,
                "movieId": row["movieId"],
                "movieTitle": row["title"]
            })

    conn.close()
    return {"status": "success", "matches": matches}

# ─────────────────────────────────────────
# ENDPOINT 6: Μαζικός μέσος όρος ratings
# POST /movielens/api/average-ratings
# ─────────────────────────────────────────
class MovieIdsRequest(BaseModel):
    movieIds: List[int]

@app.post("/movielens/api/average-ratings")
def average_ratings(request: MovieIdsRequest):
    conn = get_conn()
    cursor = conn.cursor()

    placeholders = ",".join("?" * len(request.movieIds))
    cursor.execute(
        f"""
        SELECT movieId, ROUND(AVG(rating), 2) as avg_rating, COUNT(*) as num_ratings
        FROM ratings
        WHERE movieId IN ({placeholders})
        GROUP BY movieId
        """,
        request.movieIds
    )

    averages = {}
    for row in cursor.fetchall():
        averages[row["movieId"]] = {
            "avg": row["avg_rating"],
            "count": row["num_ratings"]
        }

    conn.close()
    return {"status": "success", "averages": averages}

# ─────────────────────────────────────────
# ΠΙΝΑΚΑΣ ΧΡΗΣΤΩΝ — δημιουργία αν δεν υπάρχει
# ─────────────────────────────────────────
def init_users_table():
    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            userId    INTEGER PRIMARY KEY AUTOINCREMENT,
            username  TEXT UNIQUE NOT NULL,
            password  TEXT NOT NULL,
            token     TEXT,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_ratings (
            userId   INTEGER,
            movieId  INTEGER,
            rating   REAL,
            fromIMDb INTEGER DEFAULT 0,
            PRIMARY KEY (userId, movieId)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_watchlist (
            userId  INTEGER,
            movieId INTEGER,
            title   TEXT,
            genres  TEXT,
            PRIMARY KEY (userId, movieId)
        )
    """)
    conn.commit()
    conn.close()

init_users_table()

# ─────────────────────────────────────────
# ΒΟΗΘΗΤΙΚΕΣ ΣΥΝΑΡΤΗΣΕΙΣ
# ─────────────────────────────────────────
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_token(token: str):
    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT userId, username FROM users WHERE token = ?", (token,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

# ─────────────────────────────────────────
# ENDPOINT: Register
# POST /movielens/api/auth/register
# ─────────────────────────────────────────
class AuthRequest(BaseModel):
    username: str
    password: str

@app.post("/movielens/api/auth/register")
def register(req: AuthRequest):
    if len(req.username) < 3:
        raise HTTPException(status_code=400, detail="Το username πρέπει να έχει τουλάχιστον 3 χαρακτήρες")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες")

    conn   = get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT userId FROM users WHERE username = ?", (req.username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Το username υπάρχει ήδη")

    hashed = hash_password(req.password)
    token  = secrets.token_hex(32)

    cursor.execute(
        "INSERT INTO users (username, password, token) VALUES (?, ?, ?)",
        (req.username, hashed, token)
    )
    userId = cursor.lastrowid
    conn.commit()
    conn.close()

    return {
        "status":   "success",
        "token":    token,
        "userId":   userId,
        "username": req.username
    }

# ─────────────────────────────────────────
# ENDPOINT: Login
# POST /movielens/api/auth/login
# ─────────────────────────────────────────
@app.post("/movielens/api/auth/login")
def login(req: AuthRequest):
    conn   = get_conn()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT userId, username, password FROM users WHERE username = ?",
        (req.username,)
    )
    user = cursor.fetchone()

    if not user or user["password"] != hash_password(req.password):
        conn.close()
        raise HTTPException(status_code=401, detail="Λάθος username ή κωδικός")

    token = secrets.token_hex(32)
    cursor.execute("UPDATE users SET token = ? WHERE userId = ?", (token, user["userId"]))
    conn.commit()
    conn.close()

    return {
        "status":   "success",
        "token":    token,
        "userId":   user["userId"],
        "username": user["username"]
    }

# ─────────────────────────────────────────
# ENDPOINT: Αποθήκευση ratings χρήστη
# POST /movielens/api/user/ratings
# ─────────────────────────────────────────
class UserRating(BaseModel):
    token:   str
    movieId: int
    rating:  float
    fromIMDb: bool = False

@app.post("/movielens/api/user/ratings")
def save_user_rating(req: UserRating):
    user = verify_token(req.token)
    if not user:
        raise HTTPException(status_code=401, detail="Μη έγκυρο token")

    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO user_ratings (userId, movieId, rating, fromIMDb)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(userId, movieId) DO UPDATE SET rating=excluded.rating
    """, (user["userId"], req.movieId, req.rating, int(req.fromIMDb)))
    conn.commit()
    conn.close()
    return {"status": "success"}

# ─────────────────────────────────────────
# ENDPOINT: Λήψη ratings χρήστη
# GET /movielens/api/user/ratings?token=xxx
# ─────────────────────────────────────────
@app.get("/movielens/api/user/ratings")
def get_user_ratings(token: str):
    user = verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Μη έγκυρο token")

    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ur.movieId, ur.rating, ur.fromIMDb, m.title
        FROM user_ratings ur
        JOIN movies m ON ur.movieId = m.movieId
        WHERE ur.userId = ?
    """, (user["userId"],))
    ratings = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "success", "ratings": ratings}

# ─────────────────────────────────────────
# ENDPOINT: Αποθήκευση watchlist
# POST /movielens/api/user/watchlist
# ─────────────────────────────────────────
class UserWatchlistItem(BaseModel):
    token:   str
    movieId: int
    title:   str
    genres:  str
    action:  str  # "add" ή "remove"

@app.post("/movielens/api/user/watchlist")
def save_user_watchlist(req: UserWatchlistItem):
    user = verify_token(req.token)
    if not user:
        raise HTTPException(status_code=401, detail="Μη έγκυρο token")

    conn   = get_conn()
    cursor = conn.cursor()

    if req.action == "add":
        cursor.execute("""
            INSERT OR IGNORE INTO user_watchlist (userId, movieId, title, genres)
            VALUES (?, ?, ?, ?)
        """, (user["userId"], req.movieId, req.title, req.genres))
    else:
        cursor.execute(
            "DELETE FROM user_watchlist WHERE userId = ? AND movieId = ?",
            (user["userId"], req.movieId)
        )

    conn.commit()
    conn.close()
    return {"status": "success"}

# ─────────────────────────────────────────
# ENDPOINT: Λήψη watchlist
# GET /movielens/api/user/watchlist?token=xxx
# ─────────────────────────────────────────
@app.get("/movielens/api/user/watchlist")
def get_user_watchlist(token: str):
    user = verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Μη έγκυρο token")

    conn   = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT movieId, title, genres FROM user_watchlist WHERE userId = ?",
        (user["userId"],)
    )
    watchlist = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "success", "watchlist": watchlist}

# ─────────────────────────────────────────
# ENDPOINT: Κοινές ταινίες με φίλο
# GET /movielens/api/user/compare?token=xxx&friend=username
# ─────────────────────────────────────────
@app.get("/movielens/api/user/compare")
def compare_with_friend(token: str, friend: str):
    user = verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Μη έγκυρο token")

    conn   = get_conn()
    cursor = conn.cursor()

    # Βρίσκουμε τον φίλο
    cursor.execute("SELECT userId FROM users WHERE username = ?", (friend,))
    friend_row = cursor.fetchone()
    if not friend_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Ο χρήστης δεν βρέθηκε")

    friend_id = friend_row["userId"]

    # Βρίσκουμε κοινές ταινίες
    cursor.execute("""
        SELECT 
            m.movieId, m.title, m.genres,
            ur1.rating as myRating,
            ur2.rating as friendRating
        FROM user_ratings ur1
        JOIN user_ratings ur2 ON ur1.movieId = ur2.movieId
        JOIN movies m ON ur1.movieId = m.movieId
        WHERE ur1.userId = ? AND ur2.userId = ?
        ORDER BY (ur1.rating + ur2.rating) DESC
    """, (user["userId"], friend_id))

    common = [dict(row) for row in cursor.fetchall()]

    # Στατιστικά σύγκρισης
    my_avg     = sum(r["myRating"]     for r in common) / len(common) if common else 0
    friend_avg = sum(r["friendRating"] for r in common) / len(common) if common else 0

    # Ταινίες που συμφωνούν (διαφορά <= 0.5)
    agreed = [r for r in common if abs(r["myRating"] - r["friendRating"]) <= 0.5]

    # Ταινίες που διαφωνούν (διαφορά >= 2)
    disagreed = sorted(
        [r for r in common if abs(r["myRating"] - r["friendRating"]) >= 2],
        key=lambda x: abs(x["myRating"] - x["friendRating"]),
        reverse=True
    )

    conn.close()
    return {
        "status":       "success",
        "friendName":   friend,
        "commonCount":  len(common),
        "common":       common[:20],  # top 20
        "agreedCount":  len(agreed),
        "disagreed":    disagreed[:5],
        "myAvg":        round(my_avg, 2),
        "friendAvg":    round(friend_avg, 2)
    }