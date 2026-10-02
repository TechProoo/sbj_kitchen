import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminPanel } from './pages/AdminPanel';
import { FeedAdmin } from './pages/FeedAdmin';
import { BoardPage } from './pages/BoardPage';
import { LoginPage } from './pages/LoginPage';
import { MenuAdmin } from './pages/MenuAdmin';

/// Sales figures are for the owner and the managers; a cook signing in on the
/// pass gets sent back to the board rather than an error page.
const PANEL_ROLES = ['ADMIN', 'MANAGER'];

/// Cooks can add and edit dishes too; removing them stays with the managers.
const MENU_ROLES = [...PANEL_ROLES, 'KITCHEN'];

function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="centered">
        <p>Opening the board…</p>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route
        path="/admin/panel"
        element={
          user.role && PANEL_ROLES.includes(user.role) ? (
            <AdminPanel />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/admin/feed"
        element={
          user.role && PANEL_ROLES.includes(user.role) ? (
            <FeedAdmin />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/admin/menu"
        element={
          user.role && MENU_ROLES.includes(user.role) ? (
            <MenuAdmin />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
