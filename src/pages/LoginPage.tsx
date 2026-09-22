import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { signIn, error, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch {
      // The provider surfaces the message through `error`.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <img
          className="mark"
          src="/brand/sbj-logo.png"
          alt=""
          width={56}
          height={56}
        />
        <h1>Kitchen Display</h1>
        <p>Sign in with your staff account to open the board.</p>

        {!configured && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            Supabase is not configured yet. Add VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY to <code>kitchen/.env</code>, then reload.
          </div>
        )}

        <form className="login-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && <div className="alert">{error}</div>}

          <button
            type="submit"
            className="btn"
            disabled={submitting || !configured}
          >
            {submitting ? 'Signing in…' : 'Open the board'}
          </button>
        </form>
      </div>
    </div>
  );
}
