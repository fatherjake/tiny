# Login

Login lets a user sign in with email and password and lands them on the home screen. (Example only. Replace with a real feature.)

## Sub-features

- `login-success` signs in with valid credentials.
- `login-invalid` rejects bad credentials with a visible error.
- `login-logout` ends the session.

## How to get to it (user POV)

- Open `<url>/login`.
- Choose `Sign in` in the header when logged out.

## Driving it with <harness>

Preconditions:

- App is healthy per `scripts/doctor.sh`.
- Test user `<email>` exists (see `reference/test-accounts.md`).

- **Valid sign-in.** Fill `Email` and `Password`, choose `Sign in`. The heading `Home` appears and the header shows the user's name.
- **Invalid sign-in.** Use a wrong password. An alert named `Invalid credentials` appears and the URL stays on `/login`.
- **Log out.** Choose `Sign out`. The `Sign in` button returns.
- **Proof.** Save an accessibility snapshot and a screenshot of each end state.

## Gotchas

- A redirect to `Home` alone does not prove the session. Reload and confirm you are still signed in.
- Rate limits may lock the test user after repeated invalid attempts.
