# Perfana Keycloak Theme

Custom Keycloak login theme matching the Perfana application design system.

## Features

- Modern, clean login page design
- Matches Perfana's color palette and typography
- Inter font family
- Responsive design for mobile devices
- Smooth animations and transitions
- Support for social login providers
- Custom styled form inputs and buttons

## Installation

### Option 1: Copy to Keycloak Themes Directory

1. Copy the `perfana` folder to your Keycloak themes directory:

```bash
cp -r perfana /opt/keycloak/themes/
```

For Docker deployments:
```bash
docker cp perfana keycloak:/opt/keycloak/themes/
```

2. Restart Keycloak to load the new theme.

### Option 2: Docker Volume Mount

Add the theme as a volume in your `docker-compose.yml`:

```yaml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:latest
    volumes:
      - ./keycloak-theme/perfana:/opt/keycloak/themes/perfana:ro
    # ... other configuration
```

### Option 3: Build into Custom Keycloak Image

Create a Dockerfile:

```dockerfile
FROM quay.io/keycloak/keycloak:latest

COPY perfana /opt/keycloak/themes/perfana
```

Build and use your custom image:
```bash
docker build -t perfana-keycloak .
```

## Configuration

### Enable the Theme in Keycloak Admin Console

1. Log in to the Keycloak Admin Console
2. Select your realm (or the master realm for global settings)
3. Go to **Realm Settings** > **Themes**
4. Set **Login Theme** to `perfana`
5. Click **Save**

### Configure via Environment Variables

For Docker deployments, you can set the default theme:

```yaml
environment:
  KC_SPI_THEME_DEFAULT: perfana
```

Or via CLI arguments:
```bash
--spi-theme-default=perfana
```

## Customization

### Colors

Edit `login/resources/css/login.css` to modify the color palette:

```css
:root {
  /* Brand Colors - modify these to match your brand */
  --perfana-brand-500: #0284c7;
  --perfana-brand-600: #0369a1;
  --perfana-brand-700: #075985;

  /* Other colors... */
}
```

### Logo

Replace `login/resources/img/perfana-logo.svg` with your own logo.

Update the logo width in `login/theme.properties`:
```properties
logoWidth=180px
```

### Fonts

The theme uses Google Fonts (Inter). To use a different font:

1. Update the `@import` in `login.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=YourFont:wght@400;500;600;700&display=swap');
```

2. Update the font-family in CSS:
```css
html, body {
  font-family: 'YourFont', sans-serif;
}
```

## Theme Structure

```
perfana/
  login/
    theme.properties          # Theme configuration
    resources/
      css/
        login.css             # Main stylesheet
      img/
        perfana-logo.svg      # Logo
        favicon.ico           # Favicon (optional)
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Troubleshooting

### Theme Not Appearing

1. Ensure the theme folder is in the correct location
2. Restart Keycloak after adding the theme
3. Clear browser cache

### Styles Not Loading

1. Check browser console for 404 errors
2. Verify file permissions
3. Ensure `theme.properties` references correct file paths

### Logo Not Showing

1. Verify the logo file exists at `resources/img/perfana-logo.svg`
2. Check the `logo` path in `theme.properties`

## Development

To preview changes during development:

1. Mount the theme directory to Keycloak
2. Enable theme caching disable in Keycloak:
   ```
   --spi-theme-cache-themes=false
   --spi-theme-cache-templates=false
   --spi-theme-static-max-age=-1
   ```
3. Refresh the login page to see changes

## License

This theme is part of the Perfana project.
