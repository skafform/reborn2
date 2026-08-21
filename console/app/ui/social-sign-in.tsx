import { authClient, callbackURL } from "../lib/auth";
import { Button } from "./controls";
import { knownProviders } from "./providers";

/**
 * Sign in, or sign up, with a provider.
 *
 * The same component serves both: with OAuth there is no difference — the
 * account is created on first arrival and reused after, and neither screen can
 * tell which will happen.
 *
 * `providers` comes from the server (`GET /api/auth-providers`); the console
 * never assumes a provider is configured, since credentials are optional per
 * deployment.
 */
export function SocialSignIn({
  providers,
  disabled,
}: {
  providers: string[];
  disabled?: boolean;
}) {
  const available = knownProviders(providers);
  if (available.length === 0) return null;

  return (
    <>
      <div className="console-separator">
        <span>or</span>
      </div>

      {available.map(({ id, label, Mark }) => (
        <Button
          key={id}
          type="button"
          block
          disabled={disabled}
          onClick={() =>
            authClient.signIn.social({
              provider: id,
              callbackURL: callbackURL(),
              // Where a refusal lands, with `?error=<code>`. Without it the
              // browser would end up on the backend's own error page — an
              // address the person never typed, on the wrong origin, saying
              // nothing they can act on.
              errorCallbackURL: `${window.location.origin}/login`,
            })
          }
        >
          <Mark />
          Continue with {label}
        </Button>
      ))}
    </>
  );
}
