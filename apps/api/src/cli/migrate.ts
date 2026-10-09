// CLI: pnpm db:migrate
import { runMigrations } from '../db/migrate';

runMigrations()
  .then(() => console.log('migrations applied'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
