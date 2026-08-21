import { Avatar } from "./avatar";
import { Menu, MenuItem, MenuSeparator } from "./menu";

/**
 * The signed-in person, top right, and what only concerns them.
 *
 * Signing out lives here rather than in a button of its own: it acts on the
 * account, not on the organization below it, and a menu says so where a button
 * in the bar claimed equal standing with the switcher.
 *
 * Presentational, like `OrgSwitcher`: it takes an identity and two callbacks,
 * and knows nothing of routing or of how a session ends.
 */
export function AccountMenu({
  user,
  onAccount,
  onSignOut,
}: {
  user: { id: string; email: string };
  onAccount: () => void;
  onSignOut: () => void;
}) {
  return (
    <Menu
      align="end"
      trigger={
        <>
          <Avatar seed={user.id} />
          <span className="console-muted">{user.email}</span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem
            onClick={() => {
              close();
              onAccount();
            }}
          >
            Account settings
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            Log out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
