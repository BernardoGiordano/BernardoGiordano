"""Seed the CV and the project list.

  python tools/seed_content.py [--replace]

Transcribed from ~/Documents/GitHub/cv/cv.tex rather than parsed out of it: that
file is LaTeX with a Europass class, it changes a few times a year, and a parser
for one document is more moving parts than the document. Transcribing also makes
the exclusions a decision somebody can read — the address, phone number, PEC,
date of birth and gender in the .tex are deliberately not here, and the CV tab
says to reach out on LinkedIn for the full copy.

Idempotent: rows are matched on title, so running it twice updates rather than
duplicates. `--replace` empties the tables first.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db, github  # noqa: E402

CV = [
    ("Work experience", "work", [
        (
            "Full Stack Software Developer",
            "EasyCall S.r.l. (Easy4Cloud group) — services, B2B",
            "Java (Spring Boot) and Angular development.\n"
            "Design, development and maintenance of CRM software.\n"
            "Design, development and maintenance of cloud VoIP telephony systems.\n"
            "Server-to-server integrations with Salesforce, Facebook, Instagram, WhatsApp, "
            "Google Business Profile, LinkedIn and X.\n"
            "Development and maintenance of cloud applications, and mentoring of junior engineers.",
            "2018 — today",
        ),
    ]),
    ("Education", "education", [
        (
            "Dottore Magistrale in Ingegneria Informatica",
            "Università degli Studi della Campania Luigi Vanvitelli",
            "110/110 with honours. Distributed and cloud systems, software engineering, "
            "internet protocols and security.",
            "2018 — 2021",
        ),
        (
            "Dottore in Ingegneria Elettronica e Informatica",
            "Università degli Studi della Campania Luigi Vanvitelli",
            "109/110.",
            "2014 — 2018",
        ),
    ]),
    ("Technical competences", "skills", [
        (
            "Backend",
            "Spring Framework — Boot 2.x to 4.x, Web, Data JPA, Cloud (Eureka, Gateway), Security, Messaging",
            "8+ years. REST microservices, monoliths, and hybrid Spring + JSP and Spring + Thymeleaf "
            "architectures. Java, Python, MySQL, PostgreSQL, Asterisk, Nginx, Docker, MQTT.",
            "",
        ),
        (
            "Frontend",
            "Angular 12 — 20, TypeScript, buildless web components",
            "4+ years of Angular. WebRTC softphones in Angular + Janus, and customisations of the "
            "MicroSIP softphone.",
            "",
        ),
        (
            "Embedded and open source",
            "C/C++ on Nintendo 3DS and Switch — devkitARM, devkitA64, SDL2",
            "6 years. Checkpoint, the first save manager of its kind on Switch, and PKSM: roughly six "
            "million downloads between them. Founded and ran FlagBrew, an open-source collective of "
            "eight people across the world, and released 10+ further tools and games now entrusted to it.",
            "",
        ),
        (
            "At scale",
            "A personality-test site averaging 20,000+ monthly users",
            "One million tests served.",
            "",
        ),
        (
            "Ways of working",
            "AI-assisted development, pair and extreme programming, remote collaboration",
            "Daily work with AI coding agents and prompt engineering. Solo and in-person teams, and "
            "distributed teams across time zones. Linux and macOS, command-line first. Good LaTeX, "
            "used for self-publishing layouts. 10+ years with Cubase.",
            "",
        ),
    ]),
    ("Languages", "languages", [
        ("Italian", "Mother tongue", "", ""),
        ("English", "C1 listening and reading, B2 speaking and writing", "", ""),
    ]),
    ("Awards", "awards", [
        (
            "Students for International Students",
            "Università della Campania Luigi Vanvitelli",
            "Winner, for a native Android and iOS application for Erasmus students considering a "
            "mobility period at the university.",
            "2021",
        ),
        (
            "Vanvitelli Welcome International Students",
            "Università della Campania Luigi Vanvitelli",
            "Winner, for the same brief a competition cycle earlier.",
            "2019",
        ),
    ]),
]

# `repo` is what the stats poller reads. downloads_override exists for distributions
# GitHub cannot count — an appstore, a mirror — and is left unset wherever the
# release assets are the real total, so the number keeps climbing on its own.
PROJECTS = [
    dict(
        name="Checkpoint",
        description="A save manager for Nintendo 3DS and Switch, and the first of its kind to reach "
                    "the Switch. Backs up, restores and organises game saves on the console itself.",
        url="https://github.com/BernardoGiordano/Checkpoint",
        repo="BernardoGiordano/Checkpoint",
        kind="tool", role="author", status="maintained", open_source=True, featured=True,
        platforms=["nintendo 3ds", "nintendo switch"], tech=["C++", "SDL2", "devkitARM", "devkitA64"],
        downloads_override=None,
    ),
    dict(
        name="PKSM",
        description="A save editor and manager for a family of Nintendo DS and 3DS games, running "
                    "entirely on the handheld.",
        url="https://github.com/FlagBrew/PKSM",
        repo="FlagBrew/PKSM",
        kind="tool", role="author", status="archived", open_source=True, featured=True,
        platforms=["nintendo 3ds"], tech=["C++", "devkitARM"],
        downloads_override=None,
    ),
    dict(
        name="srl",
        description="An Angular-inspired SDK for lightweight, buildless, reactive single-page "
                    "applications. Signals, a template dialect checked without a compiler, routing, "
                    "forms, i18n, auth and micro-frontends. This site runs on it.",
        url="https://github.com/BernardoGiordano/srl",
        repo="BernardoGiordano/srl",
        kind="library", role="author", status="active", open_source=True, featured=True,
        platforms=["web"], tech=["JavaScript", "Lit", "signals"],
        downloads_override=None,
    ),
    dict(
        name="FlagBrew",
        description="An open-source collective of eight developers building homebrew for Nintendo "
                    "handhelds. Founded it, ran it, and handed the projects over to it.",
        url="https://github.com/FlagBrew",
        repo="",
        kind="collective", role="author", status="active", open_source=True, featured=False,
        platforms=["nintendo 3ds", "nintendo switch"], tech=["C++", "C"],
        downloads_override=None,
    ),
]


def seed_cv(connection, replace: bool) -> None:
    if replace:
        db.execute(connection, "DELETE FROM cv_sections")

    for position, (title, kind, items) in enumerate(CV):
        existing = db.one(connection, "SELECT id FROM cv_sections WHERE title = %s", (title,))
        if existing is None:
            section_id = db.execute(
                connection,
                "INSERT INTO cv_sections (title, kind, position) VALUES (%s, %s, %s)",
                (title, kind, position),
            )
        else:
            section_id = existing["id"]
            db.execute(
                connection,
                "UPDATE cv_sections SET kind = %s, position = %s WHERE id = %s",
                (kind, position, section_id),
            )

        db.execute(connection, "DELETE FROM cv_items WHERE section_id = %s", (section_id,))
        db.many(
            connection,
            "INSERT INTO cv_items (section_id, title, subtitle, detail, period, position) VALUES (%s, %s, %s, %s, %s, %s)",
            [(section_id, t, s, d, p, i) for i, (t, s, d, p) in enumerate(items)],
        )
    print(f"cv: {len(CV)} sections, {sum(len(i) for _, _, i in CV)} items")


def seed_projects(connection, replace: bool) -> None:
    if replace:
        db.execute(connection, "DELETE FROM projects")

    for position, project in enumerate(PROJECTS):
        existing = db.one(connection, "SELECT id FROM projects WHERE name = %s", (project["name"],))
        values = (
            project["description"], project["url"], project["repo"], project["kind"],
            project["role"], project["status"], project["open_source"], project["featured"],
            db.dumps(project["platforms"]), db.dumps(project["tech"]),
            project["downloads_override"], position,
        )
        if existing is None:
            db.execute(
                connection,
                """INSERT INTO projects (name, description, url, repo, kind, role, status, open_source,
                          featured, platforms, tech, downloads_override, position)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (project["name"], *values),
            )
        else:
            db.execute(
                connection,
                """UPDATE projects SET description = %s, url = %s, repo = %s, kind = %s, role = %s,
                          status = %s, open_source = %s, featured = %s, platforms = %s, tech = %s,
                          downloads_override = %s, position = %s WHERE id = %s""",
                (*values, existing["id"]),
            )
        if project["repo"]:
            github.ensure_row(connection, project["repo"])
    print(f"projects: {len(PROJECTS)}")


if __name__ == "__main__":
    replace = "--replace" in sys.argv
    with db.connect() as connection:
        seed_cv(connection, replace)
        seed_projects(connection, replace)
    print("run `python tools/manage.py refresh-stats` to fill the GitHub numbers")
