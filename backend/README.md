# MovieLens Backend

## Απαιτήσεις
- Python 3.8+

## Εγκατάσταση

### 1. Εγκατάσταση dependencies
pip install -r requirements.txt

### 2. Δημιουργία βάσης δεδομένων
Βεβαιώσου ότι τα αρχεία movies.csv, ratings.csv και tags.csv
βρίσκονται στον φάκελο backend/ και τρέξε:

python create_db.py

### 3. Εκκίνηση server
uvicorn main:app --reload --port 3000

## Endpoints

| Method | URL | Περιγραφή |
|--------|-----|-----------|
| GET | /movielens/api/movies?search={keyword} | Αναζήτηση ταινιών |
| GET | /movielens/api/ratings/{movieId} | Ratings ταινίας |
| POST | /movielens/api/movies | Προσθήκη ταινίας |
| POST | /movielens/api/recommendations | Προτάσεις ταινιών |

## Σημειώσεις
- Ο server τρέχει στο http://localhost:3000
- Το frontend ανοίγει με διπλό κλικ στο frontend/index.html