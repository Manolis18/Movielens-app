const CACHE_NAME = "movielens-v1";
const ASSETS = [
    "/Movielens-app/frontend/",
    "/Movielens-app/frontend/index.html",
    "/Movielens-app/frontend/index.css",
    "/Movielens-app/frontend/index.js",
    "/Movielens-app/frontend/MvL.ico"
];

// Εγκατάσταση — κάνουμε cache τα βασικά αρχεία
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Ενεργοποίηση — καθαρίζουμε παλιές cached εκδόσεις
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — αν είμαστε offline, χρησιμοποιούμε cache
self.addEventListener("fetch", event => {
    // Για API calls δεν χρησιμοποιούμε cache
    if (event.request.url.includes("onrender.com") ||
        event.request.url.includes("themoviedb.org")) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Αποθηκεύουμε φρέσκια έκδοση στο cache
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});