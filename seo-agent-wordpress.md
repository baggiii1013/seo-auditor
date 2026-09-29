# WordPress

This repository is WordPress. Everything above still applies. These rules come on top, because WordPress fails differently from other stacks: one PHP error in a theme or plugin takes down every page of the site (the "white screen"), and much of what a crawl sees is not in the repository at all.

## Know what this repository is

Work this out before any change, and say which it is in your summary:

- **A whole site:** `wp-content/` with `themes/` and `plugins/`, often `wp-config.php` or `wp-config-sample.php` at the web root.
- **Bedrock:** `web/app/` instead of `wp-content/`, WordPress itself in `web/wp/`, config in `config/`, plugins from Composer.
- **A single theme:** `style.css` with a `Theme Name:` header and `functions.php` at the root. A `Template:` header makes it a child theme.
  - **Classic theme:** `header.php`, `footer.php`, `single.php` and friends.
  - **Block theme:** `theme.json`, `templates/*.html` and `parts/*.html`.
- **A single plugin:** a PHP file with a `Plugin Name:` header.

## Never touch

- WordPress core: `wp-admin/`, `wp-includes/`, the `wp-*.php` files at the web root, Bedrock's `web/wp/`. Updates overwrite them.
- `wp-config.php`, `.htaccess`, `web.config`, `nginx.conf`: one mistake here is a site-wide outage.
- `wp-content/uploads/`, `wp-content/cache/`, `vendor/`, and anything Composer or WPackagist installs.
- **Third-party themes and plugins.** Updates overwrite any change you make there. They usually have a `readme.txt` with `Stable tag:` and `Contributors:`, come from Composer, or are well-known names. Only edit the site's own code: its custom theme, its child theme, its own plugins and `mu-plugins`.
- If the only theme is a third-party one with no child theme, skip template findings. Making a child theme needs someone to activate it in the admin.

## Much of it lives in the database, not here

Post and page content, menus, widgets, media alt text, the site title and tagline, and every plugin's settings are in the database. A finding that comes from that content (a heading inside a post, alt text on an image in a post, a page's own title) cannot be fixed from the repository. Skip it, and say where in the admin it is changed. Never work around it by filtering `the_content` with regular expressions.

**Settings → Reading → "Discourage search engines"** makes WordPress serve `Disallow: /` and `noindex`. If robots.txt blocks everything and no file or code in the repository does it, that setting is the cause. Skip, and say so.

## SEO plugins own the head

Check `plugins/` (or `composer.json`) for Yoast (`wordpress-seo`), Rank Math (`seo-by-rank-math`), All in One SEO (`all-in-one-seo-pack`), SEOPress (`wp-seopress`) or The SEO Framework (`autodescription`). If one is there, it outputs the title, meta description, canonical, Open Graph, schema, robots.txt rules and the sitemap, all from its settings in the database.

- Do **not** add those tags from the theme as well. Two canonicals or two descriptions are worse than one wrong one.
- Skip those findings, and name the plugin setting that fixes each one.

## How WordPress does each thing (only when no SEO plugin does)

- **Title:** `add_theme_support( 'title-tag' )` in an `after_setup_theme` hook, and no hard-coded `<title>` in `header.php`. Change the text with the `document_title_parts` filter.
- **Meta description, Open Graph, JSON-LD:** print them from a `wp_head` action. Build them from what WordPress already has: `get_the_excerpt()`, `get_bloginfo( 'description' )`, `get_the_title()`, `get_permalink()`, `get_the_post_thumbnail_url()`. Print JSON-LD with `wp_json_encode()` inside `<script type="application/ld+json">`.
- **Canonical:** WordPress prints one on single posts and pages already (`rel_canonical`). Never add a second one there. Only add one where none is printed.
- **`lang`, charset, viewport (classic themes):** `<html <?php language_attributes(); ?>>`, `<meta charset="<?php bloginfo( 'charset' ); ?>">`, and a viewport meta in `header.php`. `wp_head()` must stay right before `</head>`, and `wp_body_open()` right after `<body>`. Block themes print these from core, so look for the reason elsewhere.
- **robots.txt:** WordPress serves a virtual one. Change it with the `robots_txt` filter. Only write a real `robots.txt` file when the repository holds the web root. Never disallow `/wp-content/` or `/wp-includes/`, because crawlers need the CSS and JS to render pages. Keep `Allow: /wp-admin/admin-ajax.php`.
- **Sitemap:** WordPress 5.5 and later serves one at `/wp-sitemap.xml` and names it in the virtual robots.txt. Never write a static sitemap. If it is missing, look for `wp_sitemaps_enabled` returning false or a plugin turning it off, and report what you find.
- **llms.txt:** a static file at the web root, only when the repository holds the web root (next to `wp-config.php`, or `web/` in Bedrock). In a theme-only or plugin-only repository, skip it and say why.
- **Headings in classic templates:** the site name is often an `<h1>` on every page. Make it `<h1>` only when `is_front_page()`, and a `<p>` or `<div>` otherwise.
- **Theme images:** alt text comes from the media library for anything printed with `the_post_thumbnail()` or `wp_get_attachment_image()`. Only hard-coded `<img>` tags in templates are yours to fix.

## Where new code goes

1. The site's own child theme's `functions.php`, or its custom theme's if there is no child theme.
2. With no such theme, but `wp-content/` (or Bedrock's `web/app/`) present: a new must-use plugin at `wp-content/mu-plugins/seo-auditor.php`. It loads without activation and survives a theme switch. Start it with `<?php`, then a header comment `/* Plugin Name: SEO fixes (seo-auditor) */`, then `defined( 'ABSPATH' ) || exit;`.
3. In a plugin-only repository: that plugin's main file or its includes, following its structure.

Append to the end of `functions.php`. Do not restructure what is there.

## PHP that cannot take the site down

Write defensively, then read the file again after each edit to check the code around your change. If you have `run`, also `php -l` every PHP file you changed. It only catches syntax errors, not a call to a function that does not exist:

- **Hooks with closures:** `add_action( 'wp_head', function () { ... } );`. A named function risks "cannot redeclare", a fatal error. If you must name one, prefix it `seo_auditor_` and wrap it in `if ( ! function_exists( ... ) )`.
- **Old PHP syntax,** unless `composer.json`, `style.css` or `readme.txt` states a higher "Requires PHP". Write PHP 7.2: no arrow functions (`fn`), no `match`, no named arguments, no nullsafe `?->`, no typed properties, no union types.
- **No closing `?>`** at the end of a file that is pure PHP. Whitespace after it breaks every redirect and cookie.
- **Mixed templates:** know whether each line is inside `<?php … ?>` or in HTML before you edit it, and keep every tag you open closed.
- **Escape everything printed:** `esc_attr()`, `esc_url()`, `esc_html()`, `wp_json_encode()`. Never print `$_GET`, `$_POST` or `$_SERVER` values.
- **Translations:** if the theme wraps its strings in `__()` or `esc_html__()` with a text domain, wrap new user-visible strings the same way, with the same domain.
- **Guard for functions that may not exist:** use `function_exists()` for anything from a plugin, and `is_singular()`, `is_front_page()` and similar to limit output to the pages the finding names.

## Block themes

`templates/*.html` and `parts/*.html` are block markup. Each block is an HTML comment carrying JSON (`<!-- wp:heading {"level":1} -->`) followed by HTML that must match it exactly. Change both together: `{"level":2}` with `<h2 class="wp-block-heading">`. A mismatch shows the editor's "This block contains unexpected or invalid content". Keep the JSON valid, and do not reformat blocks you are not changing.

## In your summary

Say what kind of WordPress repository this is, where the code went, and anything the reviewer must do in the admin: a plugin setting, the Reading setting, or activating a child theme. Page caches (a caching plugin, or the host's) may keep serving the old head until they are purged, so say that too.
