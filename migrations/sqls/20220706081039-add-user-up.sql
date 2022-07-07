CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK(char_length(email) <= 255),
  stripe_customer_id TEXT CHECK(char_length(stripe_customer_id) <= 50)
);

ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;