import sqlite3
import csv
import os

# Βρίσκουμε τον φάκελο που βρίσκεται το script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Δημιουργούμε (ή ανοίγουμε) τη βάση δεδομένων
conn = sqlite3.connect(os.path.join(BASE_DIR, "movielens.db"))
cursor = conn.cursor()

# ─────────────────────────────────────────
# ΠΙΝΑΚΑΣ 1: movies
# movieId | title | genres
# ─────────────────────────────────────────
cursor.execute("""
    CREATE TABLE IF NOT EXISTS movies (
        movieId  INTEGER PRIMARY KEY,
        title    TEXT NOT NULL,
        genres   TEXT
    )
""")

# ─────────────────────────────────────────
# ΠΙΝΑΚΑΣ 2: ratings
# userId | movieId | rating | timestamp
# ─────────────────────────────────────────
cursor.execute("""
    CREATE TABLE IF NOT EXISTS ratings (
        userId     INTEGER,
        movieId    INTEGER,
        rating     REAL,
        timestamp  INTEGER
    )
""")

# ─────────────────────────────────────────
# ΠΙΝΑΚΑΣ 3: tags
# userId | movieId | tag | timestamp
# ─────────────────────────────────────────
cursor.execute("""
    CREATE TABLE IF NOT EXISTS tags (
        userId     INTEGER,
        movieId    INTEGER,
        tag        TEXT,
        timestamp  INTEGER
    )
""")

print("Pinakes dimiourghthikan.")

# ─────────────────────────────────────────
# ΦΟΡΤΩΣΗ ΔΕΔΟΜΕΝΩΝ από τα CSV
# ─────────────────────────────────────────

# --- movies.csv ---
movies_path = os.path.join(BASE_DIR, "movies.csv")
with open(movies_path, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = [(int(r["movieId"]), r["title"], r["genres"]) for r in reader]
cursor.executemany("INSERT OR IGNORE INTO movies VALUES (?, ?, ?)", rows)
print(f"movies: {len(rows)} eggrafes fortothikan.")

# --- ratings.csv ---
ratings_path = os.path.join(BASE_DIR, "ratings.csv")
with open(ratings_path, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = [(int(r["userId"]), int(r["movieId"]), float(r["rating"]), int(r["timestamp"])) for r in reader]
cursor.executemany("INSERT INTO ratings VALUES (?, ?, ?, ?)", rows)
print(f"ratings: {len(rows)} eggrafes fortothikan.")

# --- tags.csv ---
tags_path = os.path.join(BASE_DIR, "tags.csv")
with open(tags_path, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = [(int(r["userId"]), int(r["movieId"]), r["tag"], int(r["timestamp"])) for r in reader]
cursor.executemany("INSERT INTO tags VALUES (?, ?, ?, ?)", rows)
print(f"✅ tags: {len(rows)} εγγραφές φορτώθηκαν.")

# Αποθηκεύουμε και κλείνουμε
conn.commit()
conn.close()

print("H vasi dedomenon movielens.db einai etoimi!")