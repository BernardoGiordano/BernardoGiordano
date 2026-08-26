export interface Profile {
  name: string;
  headline: string;
  bio: string;
  location: string;
  current: string;
  now: string;
  available: string;
  avatarUrl: string;
  email: string;
}

export interface SiteLink {
  id: number;
  kind: string;
  label: string;
  url: string;
  position: number;
}

/**
 * The tab bar's two numbers, summed by the backend over every non-fork
 * repository the accounts in GITHUB_OWNERS own — not over the project list —
 * with a registry's count standing in for GitHub's wherever a project declares
 * a package.
 */
export interface SiteTotals {
  stars: number;
  downloads: number;
  repos: number;
  refreshedAt: string | null;
}

export interface ProjectStats {
  stars: number | null;
  forks: number | null;
  downloads: number | null;
  lastReleaseAt: string | null;
  lastReleaseTag: string | null;
  firstCommitAt: string | null;
  language: string | null;
  license: string | null;
  refreshedAt: string | null;
}

/**
 * A registry's own count for a project, where GitHub is not where the downloads
 * happen. npm's figure is every install the registry will still answer for and
 * not strictly all-time; Docker Hub's `pull_count` is.
 */
export interface PackageStats {
  registry: string;
  name: string;
  downloads: number | null;
  url: string;
  refreshedAt: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  url: string;
  repo: string;
  kind: string;
  role: string;
  status: string;
  openSource: boolean;
  featured: boolean;
  platforms: readonly string[];
  tech: readonly string[];
  downloadsOverride: number | null;
  packageRegistry: string;
  packageName: string;
  position: number;
  stats: ProjectStats | null;
  packageStats: PackageStats | null;
}

export interface ArtWork {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  kind: string;
  label: string;
  releasedOn: string;
  formats: readonly string[];
  coverUrl: string;
  bandcampAlbumId: string;
  catalogNumber: string;
  links: readonly { label: string; url: string }[];
  tracks: readonly { position: number; title: string; duration: string }[];
  position: number;
}

export interface CvItem {
  id: number;
  title: string;
  subtitle: string;
  detail: string;
  period: string;
  position: number;
}

export interface CvSection {
  id: number;
  title: string;
  kind: string;
  position: number;
  items: readonly CvItem[];
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string;
  publishedOn: string;
  tags: readonly string[];
  coverUrl: string;
  readingMinutes: number;
  language: string;
  draft: boolean;
  /** How many times the post has been opened, counted per reader per window. */
  views: number;
}

export interface Post extends PostSummary {
  body: string;
}

export interface PostPage {
  rows: readonly PostSummary[];
  total: number;
}
