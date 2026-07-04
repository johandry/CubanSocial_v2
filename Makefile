.PHONY: test test-watch test-coverage

# Run all client-side JS tests once (Vitest)
test:
	npm test

# Run tests in watch mode (re-runs on file changes)
test-watch:
	npm run test:watch

# Run tests with V8 coverage report
test-coverage:
	npm run test:coverage

# Run Supabase Edge Function tests (requires Deno)
test-edge:
	deno test --allow-env supabase/functions/notify-admin/index.test.ts
	deno test --allow-env supabase/functions/parse-event/index.test.ts
