CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name varchar(80) NOT NULL,
  email varchar(255) UNIQUE,
  phone varchar(20) UNIQUE,
  password_hash varchar(255),
  google_id varchar(255) UNIQUE,
  account_kind varchar(20) NOT NULL CHECK (account_kind IN ('customer', 'business')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username varchar(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_method varchar(20) NOT NULL DEFAULT 'email';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_method varchar(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
UPDATE users SET signup_method = CASE WHEN google_id IS NOT NULL THEN 'google' WHEN password_hash IS NULL AND phone IS NOT NULL THEN 'phone' ELSE 'email' END WHERE last_login_at IS NULL;
UPDATE users SET username = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 6) WHERE username IS NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username);
CREATE TABLE IF NOT EXISTS profile_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio varchar(240) NOT NULL DEFAULT '',
  language varchar(20) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur', 'roman-ur')),
  show_last_seen boolean NOT NULL DEFAULT true,
  allow_read_receipts boolean NOT NULL DEFAULT true,
  allow_broadcasts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name varchar(120) NOT NULL,
  contact_person_name varchar(80) NOT NULL,
  phone varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_requests_one_pending_per_user ON business_requests(user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS business_requests_status_idx ON business_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS follows (
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, business_id),
  CHECK (customer_id <> business_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, business_id)
);
CREATE INDEX IF NOT EXISTS conversations_customer_idx ON conversations(customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_business_idx ON conversations(business_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS conversation_user_states (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 archived boolean NOT NULL DEFAULT false, muted boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,conversation_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  expiration_time bigint,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint)
);
CREATE TABLE IF NOT EXISTS broadcast_lists (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS broadcast_list_members (
  list_id uuid NOT NULL REFERENCES broadcast_lists(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(list_id,customer_id)
);
CREATE TABLE IF NOT EXISTS business_broadcasts (
  id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES broadcast_lists(id) ON DELETE CASCADE,
  title varchar(100) NOT NULL, body text NOT NULL,
  image_urls jsonb NOT NULL DEFAULT '[]', published_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE business_broadcasts ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;
ALTER TABLE business_broadcasts ADD COLUMN IF NOT EXISTS suppressed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_broadcasts ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE business_broadcasts ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
CREATE TABLE IF NOT EXISTS broadcast_list_targets (
  broadcast_id uuid NOT NULL REFERENCES business_broadcasts(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES broadcast_lists(id) ON DELETE CASCADE,
  PRIMARY KEY(broadcast_id,list_id)
);
CREATE TABLE IF NOT EXISTS broadcast_customer_states (
  broadcast_id uuid NOT NULL REFERENCES business_broadcasts(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz, saved boolean NOT NULL DEFAULT false,
  reported_at timestamptz, PRIMARY KEY(broadcast_id,customer_id)
);
ALTER TABLE broadcast_customer_states ADD COLUMN IF NOT EXISTS report_resolution varchar(20) CHECK (report_resolution IN ('dismissed','suppressed'));
ALTER TABLE broadcast_customer_states ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE broadcast_customer_states ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS muted_businesses (
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(customer_id,business_id)
);
CREATE TABLE IF NOT EXISTS broadcast_drafts (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 list_id uuid REFERENCES broadcast_lists(id) ON DELETE SET NULL, title varchar(100) NOT NULL DEFAULT '',
 body text NOT NULL DEFAULT '', image_urls jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);


-- Broadcast deliveries are immutable recipient snapshots inside the inbox.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS broadcast_id uuid REFERENCES business_broadcasts(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS messages_broadcast_conversation_idx ON messages(broadcast_id,conversation_id) WHERE broadcast_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='broadcast-inbox-v1') THEN
    INSERT INTO messages(id,conversation_id,sender_id,body,created_at,read_at,broadcast_id,title,image_urls)
      SELECT gen_random_uuid(),c.id,b.business_id,b.body,b.published_at,s.read_at,b.id,b.title,b.image_urls
      FROM business_broadcasts b JOIN broadcast_list_members m ON m.list_id=b.list_id
      JOIN conversations c ON c.business_id=b.business_id AND c.customer_id=m.customer_id AND c.status='accepted'
      JOIN users u ON u.id=m.customer_id AND u.is_active=true AND u.deleted_at IS NULL
      LEFT JOIN profile_settings p ON p.user_id=u.id
      LEFT JOIN broadcast_customer_states s ON s.broadcast_id=b.id AND s.customer_id=u.id
      WHERE b.suppressed_at IS NULL AND COALESCE(p.allow_broadcasts,true)=true
      ON CONFLICT (broadcast_id,conversation_id) WHERE broadcast_id IS NOT NULL DO NOTHING;
    UPDATE conversations c SET updated_at=GREATEST(c.updated_at,m.latest)
      FROM (SELECT conversation_id,MAX(created_at) latest FROM messages GROUP BY conversation_id) m WHERE c.id=m.conversation_id;
    INSERT INTO schema_migrations(name) VALUES('broadcast-inbox-v1');
  END IF;
END $$;
