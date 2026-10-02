import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ActivityLoader } from './BouncingDots';
import {
  LuBookOpen,
  LuChartColumn,
  LuNewspaper,
  LuUtensils,
} from 'react-icons/lu';

/// One strip of tabs shared by every owner page, so moving between sales, the
/// feed and the board is a single tap from anywhere instead of a hunt for the
/// right button in each header.
export function AdminTabs() {
  const { user } = useAuth();
  // Sales and the feed are the owner's; a cook sees just the menu and the board.
  const owner = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <>
    <nav className="admin-tabs" aria-label="Owner pages">
      {owner && (
        <NavLink to="/admin/panel">
          <LuChartColumn aria-hidden="true" />
          Sales
        </NavLink>
      )}
      <NavLink to="/admin/menu">
        <LuBookOpen aria-hidden="true" />
        Menu
      </NavLink>
      {owner && (
        <NavLink to="/admin/feed">
          <LuNewspaper aria-hidden="true" />
          The feed
        </NavLink>
      )}
      <NavLink to="/" end>
        <LuUtensils aria-hidden="true" />
        Kitchen board
      </NavLink>
    </nav>
    <ActivityLoader />
    </>
  );
}
