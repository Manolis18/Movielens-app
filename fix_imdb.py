import csv
import re
import os
import sqlite3

INPUT_FILE  = os.path.join(os.path.expanduser("~"), "Desktop", "movielens_app_new", "ratings.csv")
OUTPUT_FILE = os.path.join(os.path.expanduser("~"), "Desktop", "movielens_app_new", "ratings_fixed.csv")
DB_PATH     = os.path.join(os.path.expanduser("~"), "Desktop", "movielens_app_new", "backend", "movielens.db")

def get_all_titles():
    """Φορτώνει όλους τους τίτλους από τη βάση για γρήγορο matching"""
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT movieId, title FROM movies")
    movies = cursor.fetchall()
    conn.close()

    # Δημιουργούμε lookup dict με lowercase τίτλο
    lookup = {}
    for movieId, title in movies:
        # Αφαιρούμε έτος από τίτλο για matching
        clean = re.sub(r'\s*\(\d{4}\)\s*$', '', title).lower().strip()
        lookup[clean] = (movieId, title)
    return lookup

def fix_title(title, year):
    title = title.strip()
    year  = str(year).strip()

    if re.search(r'\(\d{4}\)', title):
        return title

    # Μετακινούμε "The", "A", "An" στο τέλος
    match = re.match(r'^(The|A|An)\s+(.+)$', title, re.IGNORECASE)
    if match:
        article = match.group(1)
        rest    = match.group(2)
        title   = f"{rest}, {article}"

    return f"{title} ({year})"

def fix_rating(imdb_rating):
    try:
        r         = float(imdb_rating)
        converted = round(r / 2 * 2) / 2
        return max(0.5, min(5.0, converted))
    except:
        return 3.0

def fuzzy_match(title, year, lookup):
    """Προσπαθεί να βρει match με διάφορες παραλλαγές τίτλου"""
    clean_title = title.strip()
    year_str    = str(year).strip()

    # Δοκιμές με σειρά προτεραιότητας
    attempts = []

    # 1. Ακριβής τίτλος με έτος
    attempts.append(clean_title.lower())

    # 2. Με article μετακίνηση
    match_art = re.match(r'^(The|A|An)\s+(.+)$', clean_title, re.IGNORECASE)
    if match_art:
        rest = match_art.group(2)
        art  = match_art.group(1)
        attempts.append(f"{rest}, {art}".lower())

    # 3. Χωρίς ειδικούς χαρακτήρες
    no_special = re.sub(r'[^\w\s]', '', clean_title).lower()
    attempts.append(no_special)

    # 4. Μόνο πρώτες λέξεις (για μακριά ονόματα)
    words = clean_title.lower().split()
    if len(words) > 3:
        attempts.append(" ".join(words[:4]))

    for attempt in attempts:
        if attempt in lookup:
            return lookup[attempt]

    return None

print("Φόρτωση βάσης δεδομένων...")
db_lookup = get_all_titles()
print(f"Φορτώθηκαν {len(db_lookup)} ταινίες από τη βάση.")

print("Διαβάζω το αρχείο IMDb...")
with open(INPUT_FILE, encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    rows   = list(reader)

print(f"Βρέθηκαν {len(rows)} αξιολογήσεις.")

fixed_rows  = []
matched     = 0
not_matched = []
skipped     = 0

for row in rows:
    title       = row.get("Title", "").strip()
    year        = row.get("Year", "").strip()
    your_rating = row.get("Your Rating", "").strip()
    title_type  = row.get("Title Type", "").strip()

    if title_type.lower() not in ("movie", ""):
        skipped += 1
        continue

    if not title or not year:
        skipped += 1
        continue

    fixed_rating = fix_rating(your_rating)

    # Προσπαθούμε fuzzy match
    db_match = fuzzy_match(title, year, db_lookup)

    if db_match:
        # Βρήκαμε match στη βάση — χρησιμοποιούμε τον ακριβή τίτλο της βάσης
        matched += 1
        fixed_rows.append({
            "Title":       db_match[1],  # Τίτλος από τη βάση
            "Your Rating": fixed_rating
        })
    else:
        # Δεν βρήκαμε — προσθέτουμε και τις δύο παραλλαγές
        fixed_title = fix_title(title, year)
        orig_title  = f"{title} ({year})"

        fixed_rows.append({
            "Title":       fixed_title,
            "Your Rating": fixed_rating
        })

        if fixed_title != orig_title:
            fixed_rows.append({
                "Title":       orig_title,
                "Your Rating": fixed_rating
            })

        not_matched.append(f"{title} ({year})")

with open(OUTPUT_FILE, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["Title", "Your Rating"])
    writer.writeheader()
    writer.writerows(fixed_rows)

print(f"\nΑποτελέσματα:")
print(f"  Matched στη βάση:  {matched}")
print(f"  Δεν βρέθηκαν:     {len(not_matched)}")
print(f"  Παραλείφθηκαν:    {skipped}")
print(f"  Εγγραφές CSV:     {len(fixed_rows)}")
print(f"\nΑποθηκεύτηκε: {OUTPUT_FILE}")

# Αποθηκεύουμε λίστα με ταινίες που δεν βρέθηκαν
not_found_file = os.path.join(os.path.expanduser("~"), "Desktop", "movielens_app_new", "not_found.txt")
with open(not_found_file, "w", encoding="utf-8") as f:
    f.write("\n".join(not_matched))
print(f"Ταινίες που δεν βρέθηκαν: {not_found_file}")
print("Έτοιμο!")