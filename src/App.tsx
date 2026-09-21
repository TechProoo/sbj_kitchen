import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminPanel } from './pages/AdminPanel';
import { BoardPage } from './pages/BoardPage';
import { LoginPage } from './pages/LoginPage';

/// Sales figures are for the owner and the managers; a cook signing in on the
/// pass gets sent back to the board rather than an error page.
const PANEL_ROLES = ['ADMIN', 'MANAGER'];

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
