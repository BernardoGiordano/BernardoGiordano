-- MySQL 8.0. utf8mb4 everywhere: the blog is Italian and the CV has accented
-- place names, and utf8mb3 truncates neither silently nor usefully.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  display_name  VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  scopes        VARCHAR(255) NOT NULL DEFAULT 'site:write',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- The cookie carries an opaque id; only its hash is stored, so a dump of this
-- table cannot be replayed as a live session.
CREATE TABLE IF NOT EXISTS sessions (
  id           CHAR(64)     NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  csrf_token   CHAR(43)     NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  user_agent   VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip         VARBINARY(16)   NOT NULL,
  username   VARCHAR(64)     NOT NULL,
  ok         TINYINT(1)      NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attempts_ip_time (ip, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- One row, id = 1. A settings table with a key column would let two rows exist
-- and every reader would then need to decide which one is the profile.
CREATE TABLE IF NOT EXISTS profile (
  id         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  name       VARCHAR(128)  NOT NULL DEFAULT '',
  headline   VARCHAR(255)  NOT NULL DEFAULT '',
  bio        TEXT          NOT NULL,
  location   VARCHAR(128)  NOT NULL DEFAULT '',
  current    VARCHAR(255)  NOT NULL DEFAULT '',
  -- The two lines the rail carries under the bio: what is being worked on now,
  -- and whether the answer to a message would be yes. Both optional; an empty
  -- one renders nothing rather than an empty block.
  now_text   VARCHAR(255)  NOT NULL DEFAULT '',
  available  VARCHAR(128)  NOT NULL DEFAULT '',
  email      VARCHAR(255)  NOT NULL DEFAULT '',
  avatar_url VARCHAR(512)  NOT NULL DEFAULT '',
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT ck_profile_singleton CHECK (id = 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS links (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind     VARCHAR(32)  NOT NULL,
  label    VARCHAR(64)  NOT NULL,
  url      VARCHAR(512) NOT NULL,
  position INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_links_position (position)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS projects (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name               VARCHAR(128) NOT NULL,
  description        TEXT         NOT NULL,
  url                VARCHAR(512) NOT NULL DEFAULT '',
  repo               VARCHAR(160) NOT NULL DEFAULT '',
  kind               VARCHAR(32)  NOT NULL DEFAULT '',
  role               VARCHAR(32)  NOT NULL DEFAULT 'author',
  status             VARCHAR(32)  NOT NULL DEFAULT 'active',
  open_source        TINYINT(1)   NOT NULL DEFAULT 1,
  featured           TINYINT(1)   NOT NULL DEFAULT 0,
  platforms          JSON         NOT NULL,
  tech               JSON         NOT NULL,
  downloads_override BIGINT       NULL,
  position           INT          NOT NULL DEFAULT 0,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_projects_position (position),
  KEY idx_projects_repo (repo)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Separate from projects because it is cache, not content: the poller writes
-- only here, so a failed poll can never damage an edited description.
CREATE TABLE IF NOT EXISTS github_stats (
  repo             VARCHAR(160) NOT NULL,
  stars            INT          NULL,
  forks            INT          NULL,
  downloads        BIGINT       NULL,
  language         VARCHAR(64)  NULL,
  license          VARCHAR(64)  NULL,
  last_release_tag VARCHAR(128) NULL,
  last_release_at  DATETIME     NULL,
  first_commit_at  DATETIME     NULL,
  etag             VARCHAR(128) NULL,
  -- NULL until a poll actually succeeds. A default of CURRENT_TIMESTAMP would make a
  -- placeholder row indistinguishable from a fresh poll, and the poller's own
  -- staleness check would then skip it for a whole interval.
  refreshed_at     DATETIME     NULL DEFAULT NULL,
  last_error       VARCHAR(255) NULL,
  PRIMARY KEY (repo)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Every repository the site's owners own, which is a different question from the
-- project list. The two numbers in the tab bar are the whole account plus the
-- whole organisation, and most of what they add up to has no card on the site: a
-- repository with fifty stars and no description is still fifty stars somebody
-- gave it.
--
-- Its own table rather than more rows in `github_stats`, even though the columns
-- overlap, because the two pollers have different shapes and would otherwise
-- fight over one row: `github_stats.refreshed_at` is what makes the project
-- poller skip a repository it has already seen this interval, and a sweep that
-- bumped it would starve the cards of the language, licence and release facts
-- only that poller fetches.
--
-- Forks are stored and never counted. The listing hands over a fork's star count
-- for free, so keeping the row costs nothing and the rule stays a WHERE clause
-- instead of something that needs a fresh sweep to revisit. Their releases are
-- never fetched, which is why `downloads` stays NULL for them.
CREATE TABLE IF NOT EXISTS owned_repos (
  full_name    VARCHAR(160) NOT NULL,
  owner        VARCHAR(64)  NOT NULL,
  stars        INT          NULL,
  -- NULL is "not known", not "none": SUM skips it, so a releases request that
  -- failed undercounts by that repository rather than reporting a confident
  -- wrong total. The upsert keeps the previous number in that case.
  downloads    BIGINT       NULL,
  is_fork      TINYINT(1)   NOT NULL DEFAULT 0,
  archived     TINYINT(1)   NOT NULL DEFAULT 0,
  refreshed_at DATETIME     NULL DEFAULT NULL,
  last_error   VARCHAR(255) NULL,
  PRIMARY KEY (full_name),
  KEY idx_owned_repos_owner (owner)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS art_works (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title              VARCHAR(255) NOT NULL,
  subtitle           VARCHAR(255) NOT NULL DEFAULT '',
  description        TEXT         NOT NULL,
  kind               VARCHAR(32)  NOT NULL DEFAULT '',
  label              VARCHAR(128) NOT NULL DEFAULT '',
  released_on        DATE         NOT NULL,
  formats            JSON         NOT NULL,
  cover_url          VARCHAR(512) NOT NULL DEFAULT '',
  bandcamp_album_id  VARCHAR(32)  NOT NULL DEFAULT '',
  catalog_number     VARCHAR(64)  NOT NULL DEFAULT '',
  links              JSON         NOT NULL,
  tracks             JSON         NOT NULL,
  position           INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_art_release (released_on DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cv_sections (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title    VARCHAR(128) NOT NULL,
  kind     VARCHAR(32)  NOT NULL DEFAULT '',
  position INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_cv_sections_position (position)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cv_items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_id INT UNSIGNED NOT NULL,
  title      VARCHAR(255) NOT NULL DEFAULT '',
  subtitle   VARCHAR(255) NOT NULL DEFAULT '',
  detail     TEXT         NOT NULL,
  period     VARCHAR(64)  NOT NULL DEFAULT '',
  position   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_cv_items_section (section_id, position),
  CONSTRAINT fk_cv_items_section FOREIGN KEY (section_id) REFERENCES cv_sections (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS posts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(200) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  summary         TEXT         NOT NULL,
  body            MEDIUMTEXT   NOT NULL,
  cover_url       VARCHAR(512) NOT NULL DEFAULT '',
  language        VARCHAR(8)   NOT NULL DEFAULT 'it',
  published_on    DATE         NOT NULL,
  draft           TINYINT(1)   NOT NULL DEFAULT 0,
  reading_minutes SMALLINT     NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_posts_slug (slug),
  KEY idx_posts_published (draft, published_on DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Normalised, unlike the other list columns: this one is filtered on and counted,
-- and a JSON array would make the tag rail a full scan.
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INT UNSIGNED NOT NULL,
  tag     VARCHAR(64)  NOT NULL,
  PRIMARY KEY (post_id, tag),
  KEY idx_post_tags_tag (tag),
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS media (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  digest       CHAR(64)     NOT NULL,
  purpose      VARCHAR(32)  NOT NULL DEFAULT 'post',
  base_path    VARCHAR(255) NOT NULL,
  width        INT          NOT NULL,
  height       INT          NOT NULL,
  widths       JSON         NOT NULL,
  bytes        INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_digest (digest)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- What has been looked at, as a counter per thing rather than a row per hit.
-- Two scopes, and nothing else may be written: `tab`, whose ref is one of the
-- four section keys, and `post`, whose ref is a post's slug. The endpoint checks
-- the ref against that list and against the posts table, so a caller cannot
-- invent rows here by posting names nothing on the site is called.
--
-- No log behind it. A hit table would answer questions this site does not ask —
-- when, from where, in what order — and would have to be aged out to stop
-- growing; a counter answers the one question it does ask and has a fixed size.
CREATE TABLE IF NOT EXISTS visits (
  scope    VARCHAR(16)     NOT NULL,
  ref      VARCHAR(200)    NOT NULL,
  views    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  first_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, ref)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- One row per reader per thing per window, and the row is a digest: the address
-- and the user agent go into a salted sha256 and are not stored. That is what
-- makes a refresh, a back button and a second tab one visit instead of four,
-- and it is the whole of what this table is for -- it cannot be read backwards
-- into who visited, only compared against the next request from the same
-- reader. `purge-visits` drops what is older than the window.
CREATE TABLE IF NOT EXISTS visit_marks (
  mark       CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mark),
  KEY idx_visit_marks_time (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO profile (id, name, headline, bio)
VALUES (1, '', '', '')
ON DUPLICATE KEY UPDATE id = id;
