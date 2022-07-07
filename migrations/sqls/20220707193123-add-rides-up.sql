create table rides (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    idempotency_key_id bigint references idempotency_keys on delete set null,
    origin_lat numeric(13, 10) not null,
    origin_lon numeric(13, 10) not null,
    target_lat numeric(13, 10) not null,
    target_lon numeric(13, 10) not null,
    stripe_charge_id text unique check(char_length(stripe_charge_id) <= 50),
    user_id bigint not null references users on delete restrict,
    constraint rides_user_id_idempotency_key_unique unique (user_id, idempotency_key_id)
);

create index rides_idempotency_key_id on rides (idempotency_key_id) where idempotency_key_id is not null;