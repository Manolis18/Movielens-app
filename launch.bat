@echo off
echo Εκκίνηση MovieLens App...
cd /d "C:\Users\Karagiannis Manolis\Desktop\movielens_app\backend"
start "" "C:\Users\Karagiannis Manolis\Desktop\movielens_app\frontend\index.html"
uvicorn main:app --port 3000