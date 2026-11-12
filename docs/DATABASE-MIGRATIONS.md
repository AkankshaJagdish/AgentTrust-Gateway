# Database migrations

The application currently uses SQLite in Prisma. The repository schema has evolved
through development with `prisma db push`; it does not yet contain a checked-in
`prisma/migrations` history. Do not run `prisma migrate deploy` against an empty
database until an initial migration has been generated, reviewed, and committed.

For a disposable local database, use:

```bash
npm install
cp .env.example .env
# Set DATABASE_URL to file:./dev.db
npx prisma generate
npm run db:push
```

To establish the first migration baseline in a controlled development checkout:

```bash
npx prisma migrate dev --name init
```

Review the generated SQL and test it against a fresh SQLite database and a copy of
the existing database before committing the migration directory. For a deployed
database, back it up before applying any schema change. Do not use `db push` as a
production migration mechanism.

After a reviewed migration history exists, deploy with:

```bash
npx prisma migrate deploy
```

Until that baseline is committed, migration deployment is an explicit remaining
release task. This documentation does not claim that a migration has been created.
