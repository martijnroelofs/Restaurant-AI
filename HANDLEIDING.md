# RoosterAI — Deployment Handleiding

## Wat je nodig hebt (alles gratis)
- GitHub account (github.com)
- Supabase account (supabase.com)
- Netlify account (netlify.com)

---

## Stap 1: Supabase instellen

1. Ga naar **supabase.com** → "Start your project"
2. Maak een nieuw project aan (naam: "roosterai", kies een wachtwoord en regio Europe)
3. Wacht ~2 min tot het project klaar is

### Database aanmaken
4. Ga naar **SQL Editor** (links in menu)
5. Klik "New query"
6. Kopieer de volledige inhoud van `supabase/migrations/001_schema.sql`
7. Plak in de editor → klik "Run"
8. ✓ Je database is klaar

### API keys ophalen
9. Ga naar **Project Settings** → **API**
10. Kopieer:
    - **Project URL** → dit is jouw `VITE_SUPABASE_URL`
    - **anon/public key** → dit is jouw `VITE_SUPABASE_ANON_KEY`

### Email auth instellen
11. Ga naar **Authentication** → **Providers** → **Email**
12. Zet "Confirm email" op OFF (voor eenvoudigere onboarding)
13. Ga naar **Authentication** → **URL Configuration**
14. Voeg toe bij "Redirect URLs": `https://JOUW-NETLIFY-NAAM.netlify.app/**`

---

## Stap 2: Push notificaties (optioneel)

Genereer VAPID keys op jouw computer:
```bash
npx web-push generate-vapid-keys
```
Sla de **public key** op als `VITE_VAPID_PUBLIC_KEY`

---

## Stap 3: Code op GitHub zetten

1. Ga naar **github.com** → "New repository" → naam: "roosterai"
2. Upload alle bestanden uit deze map naar het repository
   (of gebruik GitHub Desktop voor eenvoudig uploaden)

---

## Stap 4: Netlify deployment

1. Ga naar **netlify.com** → "Add new site" → "Import from Git"
2. Kies GitHub → selecteer jouw "roosterai" repository
3. Build settings worden automatisch geladen vanuit `netlify.toml`
4. Ga naar **Site settings** → **Environment variables** → voeg toe:
   ```
   VITE_SUPABASE_URL=https://JOUW_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=JOUW_ANON_KEY
   VITE_VAPID_PUBLIC_KEY=JOUW_VAPID_PUBLIC_KEY (optioneel)
   ```
5. Klik "Deploy site"
6. Na ~2 min is je app live op `https://naam.netlify.app`

### Domein aanpassen
7. Ga naar **Domain settings** → "Change site name"
8. Kies bijv. "mijnrestaurant-rooster" → URL wordt `mijnrestaurant-rooster.netlify.app`

---

## Stap 5: Eerste keer inloggen

1. Ga naar `https://JOUW-SITE.netlify.app/setup`
2. Vul je restaurantnaam en admin-gegevens in
3. Je ontvangt een bevestigingsmail (als email confirm aan staat)
4. Log in → je bent klaar!

### Medewerkers toevoegen
5. Ga naar **Personeel** → "＋ Medewerker toevoegen"
6. Vul naam, e-mail en tijdelijk wachtwoord in
7. Medewerker logt in via dezelfde URL met hun e-mail + wachtwoord
8. Ze kunnen hun wachtwoord wijzigen via Supabase Auth (via email link)

---

## Automatische email (Resend)

1. Ga naar **resend.com** → gratis account
2. Voeg je domein toe of gebruik `onboarding@resend.dev` voor testen
3. Maak een API key aan
4. Vul in de app onder **Instellingen → E-mail**:
   - Resend API Key
   - Verzendadres
5. Automatische herinnering op de 10e wordt verstuurd als medewerkers geen beschikbaarheid hebben

---

## Projectstructuur

```
roosterai/
├── index.html                  # Entry point
├── package.json                # Dependencies
├── vite.config.js              # Build config
├── netlify.toml                # Hosting config
├── .env.example                # Environment template
├── public/
│   ├── manifest.json           # PWA manifest
│   └── sw.js                   # Service worker (push)
├── src/
│   ├── main.jsx                # React entry
│   ├── App.jsx                 # Router
│   ├── components/
│   │   └── ui.jsx              # Shared components
│   ├── hooks/
│   │   └── useAuth.jsx         # Auth context
│   ├── lib/
│   │   ├── supabase.js         # Database client
│   │   └── scheduler.js        # Rooster engine
│   └── pages/
│       ├── LoginPage.jsx       # Inloggen
│       ├── SetupPage.jsx       # Eerste keer instellen
│       ├── AdminApp.jsx        # Manager interface
│       └── StaffApp.jsx        # Personeel interface
└── supabase/
    └── migrations/
        └── 001_schema.sql      # Database schema
```

---

## Wat de app kan

### Manager
- ✅ Medewerkers aanmaken (vast, oproep, min/max, stagiair)
- ✅ Bezettingstemplate per dag per afdeling
- ✅ Feestdagen (gesloten of aangepaste bezetting, 150% loonkosten)
- ✅ Piek momenten op specifieke datums
- ✅ Automatisch genereren met: beschikbaarheid, capaciteitsscores,
     minimale rust (11u), max overwerk (+4u), eerlijke verdeling
- ✅ Overwerk compensatie volgende weken
- ✅ Historisch roosteroverzicht
- ✅ Aanvragen beheren (vrije dagen + ruilen)
- ✅ Financieel dashboard (loonkosten, OT, feestdag 150%)
- ✅ Realtime updates via Supabase
- ✅ Push notificaties bij publicatie

### Personeel
- ✅ Veilig inloggen met email + wachtwoord
- ✅ Rooster bekijken (alleen na publicatie)
- ✅ Beschikbaarheid: wekelijks patroon + datum-specifiek
- ✅ Vrije dag aanvragen
- ✅ Diensten ruilen
- ✅ Google Agenda export
- ✅ Push notificaties (als ingeschakeld)

---

## Updates uitrollen

Wanneer je een nieuwe versie hebt:
1. Upload nieuwe bestanden naar GitHub
2. Netlify deployt automatisch binnen 2 minuten
3. Alle gebruikers zien direct de nieuwe versie

---

## Kosten

| Service   | Gratis tier              | Betaald           |
|-----------|--------------------------|-------------------|
| Supabase  | 500MB DB, 50.000 rows   | $25/maand         |
| Netlify   | 100GB bandbreedte        | $19/maand         |
| Resend    | 100 emails/dag           | $20/maand         |
| **Totaal**| **€0/maand**            | **~€60/maand**    |

Voor een horecazaak met <15 medewerkers pas je ruimschoots binnen de gratis tiers.
