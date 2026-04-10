import sqlite3

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import init_db, UPLOADS_DIR
from backend.routes import trades, exits, stats, charts, data, accounts, journal, admin

app = FastAPI(title="Trading Journal API", version="1.0.0")


@app.exception_handler(sqlite3.Error)
async def sqlite_error_handler(_request: Request, exc: sqlite3.Error):
    return JSONResponse(
        status_code=503,
        content={"detail": f"Database error: {exc}"},
    )


# Allow React dev server to call the API (localhost and 127.0.0.1 are different origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(trades.router)
app.include_router(exits.router)
app.include_router(stats.router)
app.include_router(charts.router)
app.include_router(data.router)
app.include_router(accounts.router)
app.include_router(journal.router)
app.include_router(admin.router)


app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


@app.on_event("startup")
def startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
