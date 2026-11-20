# Dedicated Supabase development database

Use a new synthetic-only project and the Session pooler on port 5432. Configure the Laravel CLI connection privately with `APP_ENV=local`, `DB_CONNECTION=pgsql`, database `postgres` and `DB_SSLMODE=require` or stricter. Keep `DENTALOPS_LOCAL_TARGET` for the owned local-cluster runner. Use separate, least-privilege runtime credentials for Laravel, with no schema ownership or ledger writes. Keep both sets of credentials out of Vite and Git.

From the repository root, set `SUPABASE_DEV_PROJECT` to the exact project reference and run the read-only check:

```bash
/opt/local/bin/php83 backend/artisan dentalops:supabase-development preflight --project="$SUPABASE_DEV_PROJECT"
```

Laravel uses PostgreSQL directly. Disable the Supabase Data API in the project dashboard. Rotate the exposed development database password, update Laravel's private connection credentials, and retain the existing `APP_KEY`. Run preflight again to verify the updated connection. It reports PostgreSQL grants and pooler-to-database TLS separately from the client TLS requirement. After the operator explicitly approves applying the 87 reviewed migrations to this exact project and confirms both security steps, run the following command. [Supabase Data API settings](https://supabase.com/docs/guides/api/securing-your-api#disable-the-data-api)

```bash
/opt/local/bin/php83 backend/artisan dentalops:supabase-development apply \
  --project="$SUPABASE_DEV_PROJECT" --confirm="$SUPABASE_DEV_PROJECT" \
  --data-api-disabled --password-rotated
```

The operation commits the exact 87-entry ledger atomically. A partial or existing ledger requires investigation. The command has no cleanup, reset or rollback mode.

### Seed an installed development schema

Run the seed-only dry-run first. It verifies the exact migration ledger, checks for unexpected data, and prints the fingerprint of the proposed fixtures. It uses a read-only transaction.

```bash
/opt/local/bin/php83 backend/artisan dentalops:seed-supabase-development dry-run --project="$SUPABASE_DEV_PROJECT"
```

Only after the owner approves the exact project and records below, set `FIXTURE_SHA256` to the approved fingerprint from dry-run. Set a private `DEMO_ACCOUNT_PASSWORD` of at least 16 characters in Laravel's private environment. Verify the unused Data API is disabled, then run:

```bash
/opt/local/bin/php83 backend/artisan dentalops:seed-supabase-development apply \
  --project="$SUPABASE_DEV_PROJECT" --confirm="$SUPABASE_DEV_PROJECT" \
  --fixture-sha256="$FIXTURE_SHA256" --data-api-disabled
```

The seed-only command inserts the approved records in one transaction. A retry against the unchanged fixture makes no writes. A partial fixture or additional application records stop the operation. Keep workers and schedulers off and configure non-delivering mail before trying registration.

### Synthetic catalog proposal for approval

Use the scheduling test fixture's branch and service relationships as a starting point, with explicit demo labels. The existing catalog seeders include actual clinic locations and demonstration fees, so keep them out of this synthetic dataset.

| Fixture | Proposed fields |
| --- | --- |
| Accounts | The reviewed `DemoAccountsSeeder` identities. One Owner, two Staff, one Dentist, and one Patient, all at `example.test`. |
| Services | `demo-consult` (“Demo consultation”, 30 minutes) and `demo-follow-up` (“Demo follow-up”, 60 minutes), both active and labeled “Development fixture”. Leave fees unset. |
| Branch A | `demo-a` (“Demo branch A”), `Open`, “Synthetic test point A (no clinic address)”, `14.8016000, 120.9258000`. Fixture hours 09:00–18:00 Asia/Manila on Monday, Wednesday, and Friday. |
| Branch B | `demo-b` (“Demo branch B”), `Open`, “Synthetic test point B (no clinic address)”, `14.8016000, 120.9398000`. Fixture hours 09:00–18:00 Asia/Manila on Tuesday, Thursday, and Saturday. |
| Relationships | Both services at branch A and consultation at branch B. One synthetic dentist mapped to both branches and both services. The branch service links limit the offerings. Both Staff accounts have profiles and explicit branch A scope. Owner keeps the existing Owner permissions. The Patient keeps the reviewed person and patient links. |

The proposed map points sit on either side of the existing Bocaue preview. They have no clinic addresses, phone numbers, or email addresses. Directions on the development site will point to the approved test coordinates. Keep this dataset on the dedicated development project.

For this local setup, open `http://127.0.0.1:5173` with the API at `http://127.0.0.1:8000`. Use the same loopback hostname in the browser and API configuration so Sanctum's host-only cookies are available on both ports.

### Preserve the Laravel encryption key

Edit individual settings in the existing private `backend/.env`. Keep a recovery copy of the key for this project in a private secret store or an ignored `.env.*.local` file with mode `0600`. Laravel reads `backend/.env` during normal local startup. If its key goes missing, restore the exact project key from the private backup, clear Laravel's configuration cache, and restart the local server. Only create a replacement after verifying the dedicated development database has no encrypted data that needs the old key.
