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
 *
 * ⚠️ **Sits above the form, and carries the rule that follows it.** One click
 * against a typed password is what most people will take, and putting the form
 * first said the opposite. The separator belongs here rather than in the
 * screens because this component is the one that knows whether there is
 * anything to separate — with no provider configured, both disappear together.
 *
 * ⚠️ **Above the form, not instead of it.** A screen that offers only
 * providers and a "continue with email" button pushes the fields behind a
 * navigation, where a password manager can no longer fill them on arrival —
 * and, with credentials optional here, it degrades to a page whose sole
 * purpose is one click. That trade turns at three providers or so; we have one.
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
      <div className="console-stack">
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
      </div>

      <div className="console-separator">
        <span>or</span>
      </div>
    </>
  );
}
