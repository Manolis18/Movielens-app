import csv
import re
import os

INPUT_FILE  = os.path.join(os.path.expanduser("~"), "Desktop", "movielens_app", "ratings.csv")
OUTPUT_FILE = os.path.join(os.path.expanduser("~"), "Desktop", "movielens_app", "ratings_fixed.csv")

def fix_title(title, year):
    title = title.strip()
    year  = str(year).strip()

    if re.search(r'\(\d{4}\)', title):
        return title

    # Μετακινούμε "The", "A", "An" στο τέλος όπως το MovieLens
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

print("Διαβάζω το αρχείο IMDb...")

with open(INPUT_FILE, encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    rows   = list(reader)

print(f"Βρέθηκαν {len(rows)} αξιολογήσεις.")

fixed_rows = []
skipped    = 0

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

    # Δοκιμάζουμε και τις δύο μορφές τίτλου
    fixed_title         = fix_title(title, year)
    original_title_year = f"{title} ({year})"

    fixed_rows.append({
        "Title":       fixed_title,
        "Your Rating": fix_rating(your_rating)
    })

    # Αν ο τίτλος άλλαξε, προσθέτουμε και την αρχική μορφή
    if fixed_title != original_title_year:
        fixed_rows.append({
            "Title":       original_title_year,
            "Your Rating": fix_rating(your_rating)
        })

with open(OUTPUT_FILE, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["Title", "Your Rating"])
    writer.writeheader()
    writer.writerows(fixed_rows)

print(f"Επεξεργάστηκαν: {len(rows) - skipped} ταινίες")
print(f"Παραλείφθηκαν:  {skipped}")
print(f"Εγγραφές CSV:   {len(fixed_rows)} (διπλές για μέγιστο matching)")
print(f"Αποθηκεύτηκε:   {OUTPUT_FILE}")
print("Ετοιμο!")