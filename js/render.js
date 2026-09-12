import { displayUrl } from './navigation.js';

/** Small, dependency-free HTML helpers. Every user value goes through `esc`. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function emptyState(icon, title, text) {
  return `<div class="empty"><span class="empty-icon" aria-hidden="true">${icon}</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
}

export function appCard(item, index, { editable = false } = {}) {
  const controls = editable
    ? `<button class="card-remove" type="button" data-remove="${index}" title="Remove ${esc(item.name)}" aria-label="Remove ${esc(item.name)}">×</button>`
    : '';
  return `<div class="card-wrap" data-index="${index}" ${editable ? 'draggable="true"' : ''}>
    <button class="card" type="button" data-url="${esc(item.url)}" title="${esc(item.url)}">
      <span class="card-icon" aria-hidden="true">${esc(item.icon || '✦')}</span>
      <strong>${esc(item.name || displayUrl(item.url))}</strong>
      <small>${esc(item.description || displayUrl(item.url))}</small>
    </button>${controls}</div>`;
}

export function listRow(item, { removable = false, meta = '' } = {}) {
  const remove = removable
    ? `<button class="row-remove" type="button" data-remove-url="${esc(item.url)}" title="Remove" aria-label="Remove ${esc(item.title || item.url)}">×</button>`
    : '';
  return `<div class="row">
    <button class="row-main" type="button" data-url="${esc(item.url)}">
      <span class="row-icon" aria-hidden="true">${esc(item.icon || '◈')}</span>
      <span class="row-text"><strong>${esc(item.title || displayUrl(item.url))}</strong><small>${esc(displayUrl(item.url))}</small></span>
      ${meta ? `<span class="row-meta">${esc(meta)}</span>` : ''}
    </button>${remove}</div>`;
}

export function tabButton(tab, active) {
  const icon = tab.status === 'loading' ? '<span class="tab-spinner" aria-hidden="true"></span>' : tab.status === 'error' ? '⚠' : tab.url ? '◈' : '✦';
  return `<div class="tab${active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}" role="tab" tabindex="${active ? 0 : -1}" aria-selected="${active}" data-tab="${tab.id}" title="${esc(tab.title)}${tab.url ? ' — ' + esc(tab.url) : ''}">
    <span class="tab-icon" aria-hidden="true">${icon}</span>
    <span class="tab-title">${esc(tab.title || 'New tab')}</span>
    <button class="tab-close" type="button" data-close="${tab.id}" title="Close tab" aria-label="Close ${esc(tab.title)}" tabindex="-1">×</button>
  </div>`;
}
