import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LuArrowLeft,
  LuPencil,
  LuPlus,
  LuTrash2,
  LuTriangleAlert,
} from 'react-icons/lu';
import { AdminTabs } from '../components/AdminTabs';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import type {
  MenuCategoryRef,
  MenuEditorItem,
  MenuItemInput,
} from '../lib/types';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const MAX_BYTES = 6 * 1024 * 1024;

interface Draft {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  prepMinutes: string;
  spiceLevel: string;
  isAvailable: boolean;
  isFeatured: boolean;
}

const blank = (categoryId: string): Draft => ({
  categoryId,
  name: '',
  description: '',
  price: '',
  imageUrl: '',
  prepMinutes: '15',
  spiceLevel: '0',
  isAvailable: true,
  isFeatured: false,
});

const fromItem = (item: MenuEditorItem): Draft => ({
  categoryId: item.categoryId,
  name: item.name,
  description: item.description ?? '',
  price: String(Number(item.price)),
  imageUrl: item.imageUrl ?? '',
  prepMinutes: String(item.prepMinutes),
  spiceLevel: String(item.spiceLevel),
  isAvailable: item.isAvailable,
  isFeatured: item.isFeatured,
});

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

/// Add dishes and edit the ones already on the menu. Price changes here do not
/// touch past tickets: those keep the price captured when they were placed.
export function MenuAdmin() {
  const { user } = useAuth();
  const [items, setItems] = useState<MenuEditorItem[] | null>(null);
  const [categories, setCategories] = useState<MenuCategoryRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuEditorItem | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(blank(''));
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      Promise.all([api.menuItems(), api.menuCategories()])
        .then(([list, cats]) => {
          setItems(list);
          setCategories(cats);
          setError(null);
        })
        .catch((err: unknown) =>
          setError(message(err, 'Could not load the menu.')),
        ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const resetFile = () => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

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

  const openNew = () => {
    resetFile();
    setDraft(blank(categories[0]?.id ?? ''));
    setNewCategory('');
    setError(null);
    setEditing('new');
  };

  const openEdit = (item: MenuEditorItem) => {
    resetFile();
    setDraft(fromItem(item));
    setNewCategory('');
    setError(null);
    setEditing(item);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const price = Number(draft.price);
    if (draft.name.trim().length < 2) return setError('Give the dish a name.');
    if (draft.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      return setError('Enter a valid price.');
    }

    setSaving(true);
    setError(null);
    try {
      let categoryId = draft.categoryId;
      if (newCategory.trim()) {
        categoryId = (await api.createCategory(newCategory.trim())).id;
      }
      if (!categoryId) {
        setError('Pick a category.');
        return;
      }

      let imageUrl = draft.imageUrl || undefined;
      if (file) {
        const body = new FormData();
        body.append('image', file);
        imageUrl = (await api.uploadMenuImage(body)).url;
      }

      const input: MenuItemInput = {
        categoryId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        price,
        imageUrl,
        prepMinutes: Number(draft.prepMinutes) || 15,
        spiceLevel: Number(draft.spiceLevel) || 0,
        isAvailable: draft.isAvailable,
        isFeatured: draft.isFeatured,
      };

      if (editing === 'new') await api.createMenuItem(input);
      else if (editing) await api.updateMenuItem(editing.id, input);

      setEditing(null);
      await load();
    } catch (err) {
      setError(message(err, 'That did not save.'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: MenuEditorItem) => {
    setBusyId(item.id);
    try {
      await api.setItemAvailability(item.id, !item.isAvailable);
      await load();
    } catch (err) {
      setError(message(err, 'Could not change that.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: MenuEditorItem) => {
    if (!window.confirm(`Remove ${item.name} from the menu?`)) return;
    setBusyId(item.id);
    try {
      await api.deleteMenuItem(item.id);
      await load();
    } catch (err) {
      setError(message(err, 'Could not remove that.'));
    } finally {
      setBusyId(null);
    }
  };

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
            The Menu
            <small>Add and edit dishes</small>
          </span>
        </div>

        <div className="topbar-right">
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <LuPlus aria-hidden="true" />
            Add dish
          </button>
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

      <AdminTabs />

      <div className="panel-body">
        {error && !editing && (
          <div className="alert">
            <LuTriangleAlert aria-hidden="true" />
            {error}
          </div>
        )}

        {!items && !error && <p className="muted">Loading…</p>}

        {categories.map((category) => {
          const inCategory = (items ?? []).filter(
            (item) => item.categoryId === category.id,
          );
          if (inCategory.length === 0) return null;
          return (
            <section key={category.id} className="card">
              <h2>{category.name}</h2>
              <div className="menu-admin-list">
                {inCategory.map((item) => (
                  <div
                    key={item.id}
                    className={`menu-admin-row${item.isAvailable ? '' : ' is-off'}`}
                  >
                    <div>
                      <b>{item.name}</b>
                      <small>
                        {formatMoney(item.price)}
                        {item.isAvailable ? '' : ' · sold out'}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busyId === item.id}
                      onClick={() => void toggle(item)}
                    >
                      {item.isAvailable ? 'Mark sold out' : 'Put back'}
                    </button>
                    <div className="feed-admin-actions">
                      <button
                        type="button"
                        aria-label={`Edit ${item.name}`}
                        onClick={() => openEdit(item)}
                      >
                        <LuPencil aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`Remove ${item.name}`}
                        disabled={busyId === item.id}
                        onClick={() => void remove(item)}
                      >
                        <LuTrash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {editing && (
        <div
          className="sheet-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
        >
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-head">
              <h2>
                {editing === 'new' ? 'Add a dish' : `Edit ${editing.name}`}
              </h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditing(null)}
              >
                Close
              </button>
            </div>

            <div className="sheet-body menu-form">
              {error && <div className="alert">{error}</div>}

              <label>
                Name
                <input
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </label>

              <label>
                Description
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </label>

              <div className="row">
                <label>
                  Price (₦)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.price}
                    onChange={(e) => set('price', e.target.value)}
                  />
                </label>
                <label>
                  Prep minutes
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={draft.prepMinutes}
                    onChange={(e) => set('prepMinutes', e.target.value)}
                  />
                </label>
              </div>

              <div className="row">
                <label>
                  Category
                  <select
                    value={draft.categoryId}
                    disabled={Boolean(newCategory.trim())}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  …or a new category
                  <input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  />
                </label>
              </div>

              <div className="row">
                <label>
                  Spice (0–3)
                  <input
                    type="number"
                    min="0"
                    max="3"
                    value={draft.spiceLevel}
                    onChange={(e) => set('spiceLevel', e.target.value)}
                  />
                </label>
                <div className="menu-image">
                  <span>Photo</span>
                  {(preview || draft.imageUrl) && (
                    <img src={preview ?? draft.imageUrl} alt="" />
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    className="visually-hidden-input"
                    onChange={(e) => choose(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => fileRef.current?.click()}
                  >
                    {preview || draft.imageUrl ? 'Change photo' : 'Upload photo'}
                  </button>
                </div>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.isAvailable}
                  onChange={(e) => set('isAvailable', e.target.checked)}
                />
                Available to order
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.isFeatured}
                  onChange={(e) => set('isFeatured', e.target.checked)}
                />
                Featured
              </label>

              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving
                  ? 'Saving…'
                  : editing === 'new'
                    ? 'Add to menu'
                    : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
