import requests
import sqlite3
import os
import time

# ─────────────────────────────────────────
# ΡΥΘΜΙΣΕΙΣ
# ─────────────────────────────────────────
TMDB_API_KEY = "c862dda96952702fa0e248dc1f1f0937"
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
DB_PATH      = os.path.join(BASE_DIR, "movielens.db")

# Κατεβάζουμε ταινίες από αυτά τα χρόνια
YEARS = list(range(2018, 2026))

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def fetch_movies_for_year(year):
    """Κατεβάζει τις top ταινίες ενός έτους από TMDB"""
    movies = []
    for page in range(1, 6):  # 5 σελίδες = ~100 ταινίες ανά έτος
        url = (
            f"https://api.themoviedb.org/3/discover/movie"
            f"?api_key={TMDB_API_KEY}"
            f"&primary_release_year={year}"
            f"&sort_by=vote_count.desc"
            f"&vote_count.gte=100"
            f"&page={page}"
            f"&language=en-US"
        )
        try:
            res  = requests.get(url, timeout=10)
            data = res.json()
            movies.extend(data.get("results", []))
            time.sleep(0.3)  # Rate limiting
        except Exception as e:
            print(f"Error fetching year {year} page {page}: {e}")
    return movies

def tmdb_genres_to_string(genre_ids):
    """Μετατρέπει TMDB genre IDs σε string"""
    genre_map = {
        28:    "Action",
        12:    "Adventure",
        16:    "Animation",
        35:    "Comedy",
        80:    "Crime",
        99:    "Documentary",
        18:    "Drama",
        10751: "Children",
        14:    "Fantasy",
        36:    "History",
        27:    "Horror",
        10402: "Musical",
        9648:  "Mystery",
        10749: "Romance",
        878:   "Sci-Fi",
        10770: "TV Movie",
        53:    "Thriller",
        10752: "War",
        37:    "Western"
    }
    genres = [genre_map.get(gid) for gid in genre_ids if gid in genre_map]
    return "|".join(filter(None, genres)) or "Drama"

def main():
    conn   = get_conn()
    cursor = conn.cursor()

    # Βρίσκουμε το μέγιστο movieId
    cursor.execute("SELECT MAX(movieId) FROM movies")
    max_id = cursor.fetchone()[0] or 200000
    next_id = max_id + 1

    total_added = 0
    total_skipped = 0

    for year in YEARS:
        print(f"\nΦόρτωση ταινιών {year}...")
        movies = fetch_movies_for_year(year)
        year_added = 0

        for movie in movies:
            title     = movie.get("title", "").strip()
            if not title:
                continue

            # Μορφή MovieLens: "Title (Year)"
            ml_title  = f"{title} ({year})"
            genres    = tmdb_genres_to_string(movie.get("genre_ids", []))

            # Έλεγχος αν υπάρχει ήδη
            cursor.execute(
                "SELECT movieId FROM movies WHERE LOWER(title) = LOWER(?)",
                (ml_title,)
            )
            if cursor.fetchone():
                total_skipped += 1
                continue

            # Εισαγωγή νέας ταινίας
            cursor.execute(
                "INSERT INTO movies (movieId, title, genres) VALUES (?, ?, ?)",
                (next_id, ml_title, genres)
            )
            next_id     += 1
            year_added  += 1
            total_added += 1

        print(f"  {year}: +{year_added} ταινίες")
        conn.commit()

    conn.close()
    print(f"\nΣύνολο: +{total_added} νέες ταινίες ({total_skipped} υπήρχαν ήδη)")
    print("Έτοιμο!")

if __name__ == "__main__":
    main()