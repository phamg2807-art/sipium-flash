/**
 * SQL migrations. Applied in order on boot; each runs exactly once
 * (tracked in `schema_migrations`).
 */
export interface Migration {
  id: string;
  sql: string;
}

const INIT = /* sql */ `
create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists decks (
  id             uuid primary key default gen_random_uuid(),
  owner_key      text not null,
  title          text not null,
  description    text not null default '',
  language       text not null default 'en',
  source         text not null default 'manual',
  topic          text not null default '',
  difficulty     int not null default 3 check (difficulty between 1 and 5),
  tags           text[] not null default '{}',
  is_public      boolean not null default false,
  public_slug    text unique,
  published_at   timestamptz,
  fork_of        uuid,
  copies         int not null default 0,
  studies        int not null default 0,
  learning_mode  text not null default 'general',
  search_tsv     tsvector generated always as (
                   setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                   setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(topic, '')), 'B')
                 ) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists decks_owner_updated_idx on decks (owner_key, updated_at desc);
create index if not exists decks_public_idx on decks (published_at desc) where is_public;
create index if not exists decks_public_topic_idx on decks (topic) where is_public;
create index if not exists decks_public_difficulty_idx on decks (difficulty) where is_public;
create index if not exists decks_public_mode_idx on decks (learning_mode) where is_public;
create index if not exists decks_search_idx on decks using gin (search_tsv);
create index if not exists decks_tags_idx on decks using gin (tags);

create table if not exists cards (
  id                 uuid primary key default gen_random_uuid(),
  deck_id            uuid not null references decks (id) on delete cascade,
  position           int not null default 0,
  term               text not null,
  definition         text not null default '',
  vietnamese_meaning text not null default '',
  part_of_speech     text not null default '',
  pronunciation      text not null default '',
  example_sentences  text[] not null default '{}',
  collocations       text[] not null default '{}',
  synonyms           text[] not null default '{}',
  antonyms           text[] not null default '{}',
  related_words      text[] not null default '{}',
  topics             text[] not null default '{}',
  difficulty         int not null default 3 check (difficulty between 1 and 5),
  ielts_relevance    int not null default 3 check (ielts_relevance between 1 and 5),
  source             text not null default 'manual',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cards_deck_position_idx on cards (deck_id, position);
create index if not exists cards_deck_id_idx on cards (deck_id);
create index if not exists cards_term_idx on cards (lower(term));
create index if not exists cards_topics_idx on cards using gin (topics);

create table if not exists study_states (
  card_id               uuid primary key references cards (id) on delete cascade,
  owner_key             text not null,
  deck_id               uuid not null references decks (id) on delete cascade,
  ease                  double precision not null default 2.5,
  difficulty            double precision not null default 5,
  stability             double precision not null default 0,
  interval_days         double precision not null default 0,
  last_reviewed         timestamptz,
  next_review           timestamptz,
  review_count          int not null default 0,
  correct_count         int not null default 0,
  incorrect_count       int not null default 0,
  average_response_time double precision not null default 0,
  lapses                int not null default 0,
  updated_at            timestamptz not null default now()
);

create index if not exists study_states_owner_idx on study_states (owner_key);
create index if not exists study_states_deck_idx on study_states (deck_id);
create index if not exists study_states_due_idx on study_states (owner_key, next_review);

create table if not exists review_logs (
  id            uuid primary key default gen_random_uuid(),
  owner_key     text not null,
  card_id       uuid not null references cards (id) on delete cascade,
  deck_id       uuid not null references decks (id) on delete cascade,
  rating        text not null check (rating in ('again', 'hard', 'good', 'easy')),
  question_type text not null default 'recall-definition',
  response_ms   int not null default 0,
  correct       boolean,
  reviewed_at   timestamptz not null default now()
);

create index if not exists review_logs_owner_idx on review_logs (owner_key, reviewed_at desc);
create index if not exists review_logs_card_idx on review_logs (card_id);
create index if not exists review_logs_deck_idx on review_logs (deck_id);

create table if not exists study_sessions (
  id           uuid primary key default gen_random_uuid(),
  owner_key    text not null,
  deck_id      uuid not null references decks (id) on delete cascade,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  reviewed     int not null default 0,
  remembered   int not null default 0,
  weak_topics  text[] not null default '{}',
  weak_cards   uuid[] not null default '{}'
);

create index if not exists study_sessions_owner_idx on study_sessions (owner_key, started_at desc);
create index if not exists study_sessions_deck_idx on study_sessions (deck_id);
`;

export const MIGRATIONS: Migration[] = [{ id: '001_init', sql: INIT }];
