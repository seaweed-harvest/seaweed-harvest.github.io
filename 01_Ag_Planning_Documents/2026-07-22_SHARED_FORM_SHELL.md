# Shared Form Shell

## Purpose

Every operational form should inherit one layout and navigation system. A new form should need field definitions and submission logic, not page-specific sidebar or width code.

## Required Page Structure

Use these classes for every desktop and mobile form page:

```html
<body class="admin-console-page form-record-page" data-auth-pending>
  <header class="app-header">...</header>
  <main class="app-shell admin-shell admin-layout form-record-layout">
    <aside class="admin-sidebar form-page-sidebar" aria-label="Application menu"></aside>
    <section class="admin-content admin-page-section form-page-content">
      <section class="panel form-record-panel">
        <div class="section-head compact form-panel-toolbar">...</div>
        <form>...</form>
      </section>
    </section>
  </main>
</body>
```

The Collection form remains publicly accessible, so it initializes the same sidebar through `populateAppSidebar()`. Authenticated forms and console pages initialize it through `admin_page.js`.

## Shared Behavior

- `app_navigation.js` is the only sidebar renderer.
- Pinning uses `seaweed_ag:admin_sidebar_pinned`.
- Each collapsible section uses `seaweed_ag:admin_menu:<section>`.
- Form content uses the shared `1240px` maximum width.
- Mobile navigation uses the same sidebar as an off-canvas drawer.
- Form titles and PDF controls use `form-panel-toolbar`.
- Form cards use `form-record-panel`.
- Required or recommended empty fields use `empty-value-control`.
- Online status is silent. An offline-only status symbol appears in the header.
- Pending local records use the yellow pending-record banner and its sync action.

## Adding A Form

1. Copy the required page structure above.
2. Add the form link once in `formLinks()` in `app_navigation.js`.
3. Use `admin_page.js` for authenticated forms, or call `populateAppSidebar()` and `setupAppNavigation()` for public forms.
4. Keep form-specific CSS limited to its fields and controls. Do not set a page-specific panel width or create another sidebar.
5. Reuse `form-panel-toolbar`, `form-record-panel`, field highlighting, operation feedback, and PDF helpers.
6. Add desktop and mobile checks for width, overflow, sidebar state, validation highlighting, and submission.

## Regression Checks

- Pin or unpin on one page, then confirm the same state on another.
- Expand or collapse each menu group, then confirm the same state on another.
- Confirm all form cards have equal width at the same desktop viewport.
- Confirm the mobile drawer has no page overflow.
- Confirm online status is hidden and offline status is visible.
- Confirm pending local records remain visible and syncable.
