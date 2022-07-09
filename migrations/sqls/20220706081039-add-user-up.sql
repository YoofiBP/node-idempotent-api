CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK(char_length(email) <= 255),
  stripe_customer_id TEXT CHECK(char_length(stripe_customer_id) <= 50)
);

ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;

insert into users (email,stripe_customer_id) values ('yoofi@email', '670b5566-850f-40cc-8619-052d9a00d265')