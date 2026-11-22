-- SAU Campus Club Portal schema for CockroachDB.
-- Run this in the CockroachDB database selected in the SQL Console (e.g. defaultdb).
-- This script creates the tables and seeds the six original clubs.

CREATE SEQUENCE IF NOT EXISTS users_id_seq;
CREATE SEQUENCE IF NOT EXISTS clubs_id_seq;
CREATE SEQUENCE IF NOT EXISTS applications_id_seq;
CREATE SEQUENCE IF NOT EXISTS announcements_id_seq;
CREATE SEQUENCE IF NOT EXISTS motivation_quotes_id_seq;
CREATE SEQUENCE IF NOT EXISTS application_history_id_seq;

CREATE TABLE IF NOT EXISTS users (
  id INT8 PRIMARY KEY DEFAULT nextval('users_id_seq'),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student','manager','admin')),
  email_verified_at TIMESTAMPTZ NULL,
  verification_token_hash CHAR(64) NULL,
  verification_expires_at TIMESTAMPTZ NULL,
  is_active BOOL NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS clubs (
  id INT8 PRIMARY KEY DEFAULT nextval('clubs_id_seq'),
  name VARCHAR(120) NOT NULL UNIQUE,
  category VARCHAR(40) NOT NULL,
  description STRING NOT NULL,
  focus STRING NULL,
  activities STRING NULL,
  recruitment_open BOOL NOT NULL DEFAULT TRUE,
  recruitment_deadline DATE NULL,
  manager_id INT8 NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id INT8 PRIMARY KEY DEFAULT nextval('applications_id_seq'),
  student_id INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id INT8 NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  course VARCHAR(120) NOT NULL,
  academic_year VARCHAR(30) NOT NULL,
  motivation STRING NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','shortlisted','interview_scheduled','selected','rejected','withdrawn')),
  manager_note STRING NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_club UNIQUE(student_id, club_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

CREATE TABLE IF NOT EXISTS announcements (
  id INT8 PRIMARY KEY DEFAULT nextval('announcements_id_seq'),
  club_id INT8 NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  author_id INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  body STRING NOT NULL,
  image_path VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at);

CREATE TABLE IF NOT EXISTS motivation_quotes (
  id INT8 PRIMARY KEY DEFAULT nextval('motivation_quotes_id_seq'),
  club_id INT8 NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  author_id INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_text VARCHAR(500) NOT NULL,
  attribution VARCHAR(120) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_clubs (
  user_id INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id INT8 NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, club_id)
);

CREATE TABLE IF NOT EXISTS application_history (
  id INT8 PRIMARY KEY DEFAULT nextval('application_history_id_seq'),
  application_id INT8 NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  changed_by INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NOT NULL,
  note STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO clubs(name,category,description,focus,activities) VALUES
('Coding & Robotics Club','tech','Build, experiment and collaborate on practical technology projects.','Programming, electronics and problem-solving.','Hack nights, coding sessions, robotics builds and workshops.'),
('Debating Society','arts','Develop clear arguments, confident public speaking and thoughtful discussion.','Public speaking and critical thinking.','Debates, speaking practice and discussion circles.'),
('Cultural Society','arts','Bring the campus community together through culture and creativity.','Culture, performance and campus events.','Festival celebrations, cultural showcases and performances.'),
('Photography & Film Club','arts','Tell stories and document campus life through photography and film.','Visual storytelling and filmmaking.','Photo walks, short films and creative workshops.'),
('Sports Society','sports','Make sport, fitness and teamwork part of campus life.','Sports and teamwork.','Cricket, football, badminton and other activities.'),
('Social Outreach Cell','social','Connect students with meaningful community service and awareness initiatives.','Community service and social impact.','Volunteering, awareness drives and outreach initiatives.')
ON CONFLICT (name) DO NOTHING;
