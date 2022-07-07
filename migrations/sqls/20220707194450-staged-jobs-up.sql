create table staged_jobs (
    id bigserial primary key,
    job_name text not null,
    job_args jsonb not null
);