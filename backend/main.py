from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import os
from typing import List
from scipy.stats import pearsonr

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
    # Οι ταινίες που έχει βαθμολογήσει ο χρήστης u
    user_ratings = {r.movieId: r.rating for r in request.ratings}
    rated_movies = set(user_ratings.keys())

    conn = get_conn()
    cursor = conn.cursor()

    # Βρίσκουμε όλους τους χρήστες v που έχουν βαθμολογήσει
    # τουλάχιστον μία από τις ταινίες του χρήστη u
    placeholders = ",".join("?" * len(rated_movies))
    cursor.execute(
        f"SELECT DISTINCT userId FROM ratings WHERE movieId IN ({placeholders})",
        list(rated_movies)
    )
    candidate_users = [row["userId"] for row in cursor.fetchall()]

    # Για κάθε υποψήφιο χρήστη v, φορτώνουμε τις βαθμολογίες του
    # και υπολογίζουμε Pearson correlation με τον χρήστη u
    K = 20  # αριθμός κοντινότερων γειτόνων
    similarities = {}

    for v in candidate_users:
        cursor.execute(
            "SELECT movieId, rating FROM ratings WHERE userId = ?", (v,)
        )
        v_ratings_raw = {row["movieId"]: row["rating"] for row in cursor.fetchall()}

        # Βρίσκουμε κοινές ταινίες
        common = rated_movies & set(v_ratings_raw.keys())
        if len(common) < 2:
            continue  # χρειαζόμαστε τουλάχιστον 2 κοινές για Pearson

        u_vec = [user_ratings[m] for m in common]
        v_vec = [v_ratings_raw[m] for m in common]

        try:
            corr, _ = pearsonr(u_vec, v_vec)
            if corr > 0:  # κρατάμε μόνο θετικές ομοιότητες
                similarities[v] = (corr, v_ratings_raw)
        except Exception:
            continue

    # Κρατάμε τους top-K πιο όμοιους χρήστες
    top_k = sorted(similarities.items(), key=lambda x: x[1][0], reverse=True)[:K]

    # Για κάθε ταινία που ΔΕΝ έχει δει ο u, υπολογίζουμε predicted rating
    # Συλλέγουμε υποψήφιες ταινίες από τους top-K χρήστες
    candidate_movies = set()
    for _, (_, v_ratings_raw) in top_k:
        candidate_movies.update(set(v_ratings_raw.keys()) - rated_movies)
        # Φιλτράρισμα ανά genre αν έχει οριστεί
    if request.genres:
        cursor.execute(
            "SELECT movieId FROM movies WHERE LOWER(genres) LIKE LOWER(?)",
            (f"%{request.genres}%",)
        )
        genre_ids = {row["movieId"] for row in cursor.fetchall()}
        candidate_movies = candidate_movies & genre_ids
# Φιλτράρισμα ανά genre αν έχει οριστεί
    if request.genres:
        cursor.execute(
            "SELECT movieId FROM movies WHERE LOWER(genres) LIKE LOWER(?)",
            (f"%{request.genres}%",)
        )
        genre_ids = {row["movieId"] for row in cursor.fetchall()}
        candidate_movies = candidate_movies & genre_ids
    N = request.n  # αριθμός συστάσεων
    predictions = []

    # Μέση βαθμολογία χρήστη u
    u_mean = sum(user_ratings.values()) / len(user_ratings)

    for movie_i in candidate_movies:
        numerator = 0.0
        denominator = 0.0

        for _, (sim_uv, v_ratings_raw) in top_k:
            if movie_i not in v_ratings_raw:
                continue
            # Μέση βαθμολογία χρήστη v
            v_mean = sum(v_ratings_raw.values()) / len(v_ratings_raw)
            numerator   += sim_uv * (v_ratings_raw[movie_i] - v_mean)
            denominator += abs(sim_uv)

        if denominator == 0:
            continue

        predicted = u_mean + (numerator / denominator)
        # Κλαμπάρουμε μεταξύ 0.5 και 5.0
        import random
        predicted = max(0.5, min(5.0, predicted))
        # Μικρή τυχαία διαταραχή ±0.15 για ποικιλία στις προτάσεις
        noise = random.uniform(-0.15, 0.15)
        predicted = max(0.5, min(5.0, predicted + noise))
        predictions.append((movie_i, predicted))

    # Ταξινομούμε και κρατάμε top-N
    predictions.sort(key=lambda x: x[1], reverse=True)
    top_n = predictions[:N]

    # Φέρνουμε τα στοιχεία των ταινιών από τη βάση
    recommendations = []
    for movie_id, pred_rating in top_n:
        cursor.execute("SELECT * FROM movies WHERE movieId = ?", (movie_id,))
        row = cursor.fetchone()
        if row:
            recommendations.append({
                "movieId": row["movieId"],
                "title": row["title"],
                "genres": row["genres"],
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