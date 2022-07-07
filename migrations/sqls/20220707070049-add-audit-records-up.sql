CREATE TABLE audit_records (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL CHECK(char_length(action) <= 50),
  created_at timestamptz not null default now(),
  data jsonb not null,
  origin_ip cidr not null,
  resource_id bigint not null,
  resource_type text not null check (char_length(resource_type) <= 50),
  user_id bigint not null references users on delete restrict
);
