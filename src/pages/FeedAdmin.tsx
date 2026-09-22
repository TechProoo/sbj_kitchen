import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LuArrowLeft,
  LuEye,
  LuEyeOff,
  LuImagePlus,
  LuMegaphone,
  LuTrash2,
  LuTriangleAlert,
  LuUtensils,
} from 'react-icons/lu';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import type { FeedKind, FeedPost } from '../lib/types';

/// Matches the ceiling the API enforces, so the browser can say no first.
const MAX_BYTES = 6 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
  });
}

/*
 * Posting to the customers' feed.
 *
 * Written for someone holding a phone between services: pick a picture, say
 * one thing about it, post. The preview is the same shape the app will show,
 * so nobody has to publish to find out how it looks.
 */
export function FeedAdmin() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [kind, setKind] = useState<FeedKind>('GIST');
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api
        .feedAll()
        .then((all) => {
          setPosts(all);
          setError(null);
        })
        .catch((err: unknown) =>
          setError(
            err instanceof ApiError ? err.message : 'Could not load the feed.',
          ),
        ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * An object URL is a live handle on the file: leaving it un-revoked keeps
   * the whole image in memory after the form is cleared. The cleanup fires
   * both when the preview changes and on unmount, releasing the previous one
   * either way.
   */
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const choose = (chosen: File | null) => {
    if (!chosen) return;
    if (!ACCEPT.split(',').includes(chosen.type)) {
      setError('Images only — JPEG, PNG, WebP or AVIF.');
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setError('That image is larger than 6MB. Try a smaller one.');
      return;
    }
    setError(null);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setCaption('');
    setKind('GIST');
    if (inputRef.current) inputRef.current.value = '';
  };

  const post = async () => {
    if (!file || !caption.trim()) return;
    setPosting(true);
    setError(null);

    const body = new FormData();
    body.append('image', file);
    body.append('caption', caption.trim());
    body.append('kind', kind);

    try {
      await api.createFeedPost(body);
      reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not post.');
    } finally {
      setPosting(false);
    }
  };

  const togglePublished = async (target: FeedPost) => {
    setBusyId(target.id);
    try {
      await api.setFeedPublished(target.id, !target.isPublished);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change that.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (target: FeedPost) => {
    setBusyId(target.id);
    try {
      await api.deleteFeedPost(target.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that.');
    } finally {
      setBusyId(null);
    }
  };

  const ready = Boolean(file) && caption.trim().length > 0;

  return (
    <div className="panel">
      <header className="topbar">
        <div className="topbar-brand">
          <img
            className="mark"
            src="/brand/sbj-logo.jpg"
            alt=""
            width={34}
            height={34}
          />
          <span>
            The Feed
            <small>What customers see</small>
          </span>
        </div>

        <div className="topbar-right">
          <Link to="/admin/panel" className="btn btn-ghost">
            <LuArrowLeft aria-hidden="true" />
            Panel
          </Link>
          <div className="who">
            <b>{user?.fullName ?? user?.email}</b>
            <span>{user?.role}</span>
          </div>
        </div>
      </header>

      <div className="panel-body feed-admin">
        {/* ------------------------------------------------------ composer */}

        <section className="card compose">
          <h2>New post</h2>

          <div className="compose-grid">
            <div>
              <button
                type="button"
                className={`compose-drop${preview ? ' has-image' : ''}`}
                onClick={() => inputRef.current?.click()}
              >
                {preview ? (
                  <img src={preview} alt="" />
                ) : (
                  <>
                    <LuImagePlus aria-hidden="true" />
                    <b>Choose a picture</b>
                    <span>JPEG, PNG or WebP · up to 6MB</span>
                  </>
                )}
              </button>

              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="visually-hidden-input"
                onChange={(event) => choose(event.target.files?.[0] ?? null)}
              />

              {file && (
                <button type="button" className="btn-quiet" onClick={reset}>
                  Remove picture
                </button>
              )}
            </div>

            <div className="compose-side">
              <div className="compose-kinds">
                <button
                  type="button"
                  className={kind === 'GIST' ? 'is-on' : ''}
                  onClick={() => setKind('GIST')}
                >
                  <LuUtensils aria-hidden="true" />
                  Gist
                </button>
                <button
                  type="button"
                  className={`${kind === 'PROMO' ? 'is-on' : ''} promo`}
                  onClick={() => setKind('PROMO')}
                >
                  <LuMegaphone aria-hidden="true" />
                  Offer
                </button>
              </div>

              <label className="compose-caption">
                Caption
                <textarea
                  rows={5}
                  maxLength={600}
                  placeholder="Fresh ofada just came off the fire…"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                />
                <i>{caption.length}/600</i>
              </label>

              <button
                type="button"
                className="btn btn-primary compose-send"
                disabled={!ready || posting}
                onClick={() => void post()}
              >
                {posting ? 'Posting…' : 'Post to the feed'}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert compose-alert">
              <LuTriangleAlert aria-hidden="true" />
              {error}
            </div>
          )}
        </section>

        {/* -------------------------------------------------------- posted */}

        <section className="card">
          <h2>Posted</h2>

          {!posts && <p className="muted">Loading…</p>}
          {posts && posts.length === 0 && (
            <p className="muted">Nothing posted yet.</p>
          )}

          <div className="feed-admin-list">
            {(posts ?? []).map((item) => (
              <article
                key={item.id}
                className={`feed-admin-row${item.isPublished ? '' : ' is-hidden'}`}
              >
                <img src={item.imageUrl} alt="" loading="lazy" />

                <div className="feed-admin-body">
                  <span className={`pill${item.kind === 'PROMO' ? ' is-promo' : ''}`}>
                    {item.kind === 'PROMO' ? 'Offer' : 'Gist'}
                  </span>
                  <p>{item.caption}</p>
                  <small>
                    {item.author ?? 'Kitchen'} · {timeAgo(item.createdAt)}
                    {item.isPublished ? '' : ' · hidden from customers'}
                  </small>
                </div>

                <div className="feed-admin-actions">
                  <button
                    type="button"
                    onClick={() => void togglePublished(item)}
                    disabled={busyId === item.id}
                    title={item.isPublished ? 'Hide from customers' : 'Show to customers'}
                    aria-label={item.isPublished ? 'Hide from customers' : 'Show to customers'}
                  >
                    {item.isPublished ? (
                      <LuEye aria-hidden="true" />
                    ) : (
                      <LuEyeOff aria-hidden="true" />
                    )}
                  </button>

                  <button
                    type="button"
                    className="danger"
                    onClick={() => void remove(item)}
                    disabled={busyId === item.id}
                    title="Delete this post"
                    aria-label="Delete this post"
                  >
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
