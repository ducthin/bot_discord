# PostgreSQL

The bot uses PostgreSQL as its application database. A single local PostgreSQL 17 service is suitable for the current Windows deployment. Set `DATABASE_URL` in the project's `.env`; keep that file private.

## Windows setup

1. Install PostgreSQL 17 on the same Windows machine as the bot. During installation, remember the password for the PostgreSQL administrator account, normally `postgres`.
2. Run `SETUP_POSTGRES.bat` from the project folder. The script starts the installed PostgreSQL service if needed, prompts for the administrator name and password, creates or updates the dedicated `discord_bot` login, and creates the `discord_bot` database if missing.
3. The script generates a random application password and writes the local connection string to `.env` without printing the secret.
4. To apply the requested fresh start, stop the bot and run `RESET_DATA.bat` once. This prepares dependencies if needed and clears application data without backing up or importing old JSON.
5. Run `START_BOT.bat`. The normal launcher checks dependencies and application configuration; startup creates missing application tables. If Node and the `pg` package are already installed, the setup script also runs the idempotent `db:init` step. Re-run `/setup` to configure bot channels and features after the fresh start.

The setup script never drops a database, truncates tables, imports JSON files, or prints a database password. If the named database already exists and was created by this setup script, its current contents remain. Existing roles/databases without this application's ownership marker are rejected before changing passwords or ownership. To choose unused names, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-postgres-windows.ps1 -DatabaseName my_bot -RoleName my_bot`. Each PostgreSQL CLI process has a 30-second limit, an 8-second connection timeout, and bounded SQL lock/statement waits.

The dedicated app login owns the bot database and has no PostgreSQL administrator, role-creation or database-creation privileges. If the bot and database are on separate private machines, bind PostgreSQL to a trusted network interface, restrict `pg_hba.conf` and firewall access to the bot host, and change `DATABASE_URL` to the private database address.

## Data lifecycle

PostgreSQL startup initializes the bot schema idempotently. Starting or updating the bot never resets application tables. For a clean install, point `DATABASE_URL` at a new empty database and start the bot; it initializes an empty schema.

For the requested fresh start, stop the bot and run `RESET_DATA.bat` once on Windows. If Node and dependencies are already installed, the equivalent command from the project folder is:

```powershell
npm.cmd run db:reset -- --yes
```

This command clears only the bot's application tables in the configured database, and removes the old local `data/management`, `data/history`, `data/favorites`, and `data/playlists` directories. It does not drop the database or affect other schemas. No backup or JSON import is performed. Re-run `/setup` after starting the bot to configure channels and features again. Never put `db:reset` in a startup task or update script.

JSON in `data/management`, `data/history`, `data/favorites`, and `data/playlists` is not imported. A fresh start has empty wallets, inventory, Battle records, settings, music history, favorites, and playlists. Cache files such as the downloaded CS2 price catalogue are separate from application data.

Wallet amounts use exact PostgreSQL `NUMERIC` integers in units of 0.01 xu. Wallets and inventory items have separate tables; guild records store individual settings, rooms and Battle records in JSONB rows. A transaction writes only changed rows and commits wallet, inventory and result changes together. Advisory transaction locks coordinate operations across Node processes. Existing test fixtures may use explicit file-store factories; the running bot always uses PostgreSQL and reports a connection error instead of loading old JSON.

## Connection checks

### Forgotten local administrator password on Windows

The default administrator role is usually `postgres`. Stop the bot and the exact PostgreSQL service in `services.msc`, then double-click `RESET_POSTGRES_PASSWORD.bat` normally (do not use Run as administrator). The helper reads the installed service's data path and sets a new password offline; it requires the Windows account that owns or can access that PostgreSQL data folder. It does not change authentication rules or delete databases. Enter the new password twice in the hidden prompts, then run `SETUP_POSTGRES.bat` with that password. Passwords must contain 8-256 printable ASCII characters. The helper refuses a running PostgreSQL server.

Use the PostgreSQL CLI without including passwords in command arguments:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -U discord_bot -d discord_bot -c 'SELECT current_database(), current_user;'
```

`psql` prompts for the application password. The Node process reads it from `DATABASE_URL` in `.env`.

The project also provides:

```powershell
npm run db:init
npm run db:check
```

`db:init` creates missing schema objects; `db:check` verifies the configured connection. Neither command resets data.
