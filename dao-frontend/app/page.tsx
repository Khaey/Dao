import Link from 'next/link';
import StaffInviteRedirect from '../components/StaffInviteRedirect';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const focusDark = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

const clientBenefits = [
  { title: 'Un projet structuré en lots', text: 'Décrivez vos travaux et découpez-les par lot de travaux : chaque corps de métier répond sur un périmètre précis.' },
  { title: 'Des offres comparables', text: 'Les professionnels répondent au même cadre. Vous comparez les offres sur des bases identiques, avec le détail des lots concernés.' },
  { title: 'Une attribution maîtrisée', text: 'Vous décidez lot par lot : vous gardez la main sur le choix des professionnels pour chaque partie du chantier.' },
  { title: 'Un suivi partagé', text: 'Le projet, ses documents et la messagerie de chantier sont réunis dans un espace commun avec les intervenants retenus.' },
];

const proBenefits = [
  { title: 'Un profil professionnel', text: 'Présentez votre activité et vos métiers. La soumission d’offres est ouverte après vérification de votre profil par D.A.O.' },
  { title: 'Des projets cadrés', text: 'Consultez des projets décrits par lots et répondez sur le périmètre qui correspond à votre métier.' },
  { title: 'Une offre sur un ou plusieurs lots', text: 'Soumettez une offre couvrant un seul lot ou plusieurs lots, selon votre savoir-faire, sans devoir répondre à l’ensemble du chantier.' },
  { title: 'Un chantier suivi ensemble', text: 'Une fois retenu, vous échangez avec le maître d’ouvrage dans l’espace partagé et la messagerie de chantier.' },
];

const steps = [
  { title: 'Décrire', text: 'Le maître d’ouvrage crée son projet et le découpe en lots de travaux.' },
  { title: 'Recevoir des offres', text: 'Les professionnels vérifiés répondent sur un ou plusieurs lots.' },
  { title: 'Comparer et attribuer', text: 'Les offres sont comparées et l’attribution se fait par lot.' },
  { title: 'Suivre le chantier', text: 'Un espace partagé et une messagerie réunissent les intervenants du projet.' },
];

const sampleLots = ['Gros œuvre', 'Plomberie', 'Électricité', 'Finitions'];

export default function Home() {
  return (
    <div className="min-h-screen bg-sand text-ink">
      <StaffInviteRedirect />
      <a href="#contenu" className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white ${focusDark}`}>Aller au contenu</a>

      <header className="border-b border-ink/10 bg-sand/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 md:px-6">
          <Link href="/" aria-label="D.A.O, accueil" className={`rounded-md text-xl font-bold tracking-tight ${focus}`}>D.A.O<span className="text-clay" aria-hidden="true">.</span></Link>
          <nav aria-label="Navigation principale" className="hidden items-center gap-7 text-sm font-medium text-ink/75 md:flex">
            <a className={`rounded-md hover:text-ink ${focus}`} href="#maitres-ouvrage">Maîtres d’ouvrage</a>
            <a className={`rounded-md hover:text-ink ${focus}`} href="#professionnels">Artisans et entreprises</a>
            <a className={`rounded-md hover:text-ink ${focus}`} href="#comment-ca-marche">Comment ça marche</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link className={`rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-ink/5 ${focus}`} href="/auth/login">Se connecter</Link>
            <Link className={`rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-tealdark ${focus}`} href="/auth/register">Créer un compte</Link>
          </div>
        </div>
      </header>

      <main id="contenu">
        <section aria-labelledby="titre-hero" className="mx-auto grid max-w-6xl gap-12 px-5 py-14 md:grid-cols-[1.1fr_.9fr] md:items-center md:px-6 md:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-teal">Construction et rénovation · Tunisie</p>
            <h1 id="titre-hero" className="mt-4 text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">Du projet au chantier, chaque étape devient claire.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-ink/70">D.A.O réunit maîtres d’ouvrage, artisans et entreprises dans un même espace : décrire les travaux par lots, comparer des offres et suivre le chantier ensemble.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/auth/register" className={`inline-flex items-center justify-center rounded-xl bg-teal px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-tealdark ${focus}`}>J’ai un projet</Link>
              <Link href="/auth/register" className={`inline-flex items-center justify-center rounded-xl border-2 border-ink bg-transparent px-6 py-3.5 text-base font-semibold text-ink hover:bg-ink hover:text-white ${focus}`}>Je suis professionnel</Link>
            </div>
            <p className="mt-4 text-sm text-ink/65">À l’inscription, vous choisissez votre type de compte : Client ou Artisan / Entreprise.</p>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] bg-teal p-6 text-white shadow-xl sm:p-8" role="img" aria-label="Illustration : un projet découpé en lots de travaux">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            <div className="relative" aria-hidden="true">
              <p className="text-xs font-semibold uppercase tracking-[.2em] text-white/80">Exemple illustratif</p>
              <p className="mt-3 text-xl font-semibold">Rénovation d’un logement</p>
              <ul className="mt-6 space-y-3">
                {sampleLots.map((lot, index) => (
                  <li key={lot} className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/20">
                    <span className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-md bg-white text-xs font-bold text-teal">{index + 1}</span><span className="font-medium">{lot}</span></span>
                    <span className="text-xs font-medium text-white/85">Offres comparables</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-white/85">Un lot, un périmètre, des offres à comparer.</p>
            </div>
          </div>
        </section>

        <section id="maitres-ouvrage" aria-labelledby="titre-clients" className="scroll-mt-20 border-y border-ink/10 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-20">
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-teal">Pour les maîtres d’ouvrage</p>
            <h2 id="titre-clients" className="mt-3 max-w-2xl text-3xl font-bold leading-tight md:text-4xl">Préparez, comparez et décidez en confiance.</h2>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2">
              {clientBenefits.map(item => (
                <li key={item.title} className="rounded-2xl border border-ink/10 bg-sand p-6">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 leading-7 text-ink/70">{item.text}</p>
                </li>
              ))}
            </ul>
            <Link href="/auth/register" className={`mt-10 inline-flex items-center justify-center rounded-xl bg-teal px-6 py-3.5 font-semibold text-white hover:bg-teal/90 ${focus}`}>Créer mon espace client</Link>
          </div>
        </section>

        <section id="professionnels" aria-labelledby="titre-pros" className="scroll-mt-20 bg-ink text-white">
          <div className="mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-20">
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-clay">Pour les artisans et entreprises</p>
            <h2 id="titre-pros" className="mt-3 max-w-2xl text-3xl font-bold leading-tight md:text-4xl">Répondez aux projets qui correspondent à votre métier.</h2>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2">
              {proBenefits.map(item => (
                <li key={item.title} className="rounded-2xl border border-white/15 bg-white/5 p-6">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 leading-7 text-white/75">{item.text}</p>
                </li>
              ))}
            </ul>
            <Link href="/auth/register" className={`mt-10 inline-flex items-center justify-center rounded-xl bg-clay px-6 py-3.5 font-semibold text-ink hover:bg-clay/90 ${focusDark}`}>Créer mon espace professionnel</Link>
          </div>
        </section>

        <section id="comment-ca-marche" aria-labelledby="titre-etapes" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 md:px-6 md:py-20">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-teal">Comment ça marche</p>
          <h2 id="titre-etapes" className="mt-3 max-w-2xl text-3xl font-bold leading-tight md:text-4xl">Quatre étapes, un même cadre pour tous.</h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-ink/10 bg-white p-6">
                <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-sm font-bold text-white">{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 leading-7 text-ink/70">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 max-w-3xl rounded-2xl border border-teal/30 bg-teal/5 p-5 text-sm leading-6 text-ink/75"><span className="font-semibold text-ink">Bon à savoir.</span> D.A.O structure la préparation, la comparaison et le suivi du projet. La décision d’attribution reste celle du maître d’ouvrage.</p>
        </section>

        <section aria-labelledby="titre-final" className="mx-auto max-w-6xl px-5 pb-16 md:px-6 md:pb-24">
          <div className="rounded-[2rem] bg-teal px-6 py-12 text-center text-white sm:px-10">
            <h2 id="titre-final" className="text-3xl font-bold md:text-4xl">Prêt à démarrer ?</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">Créez votre compte en quelques minutes et choisissez votre parcours.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/auth/register" className={`inline-flex items-center justify-center rounded-xl bg-white px-6 py-3.5 font-semibold text-ink hover:bg-sand ${focusDark}`}>Créer un compte</Link>
              <Link href="/auth/login" className={`inline-flex items-center justify-center rounded-xl border-2 border-white px-6 py-3.5 font-semibold text-white hover:bg-white/10 ${focusDark}`}>J’ai déjà un compte</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 md:flex-row md:items-start md:justify-between md:px-6">
          <div>
            <p className="text-lg font-bold">D.A.O<span className="text-clay" aria-hidden="true">.</span></p>
            <p className="mt-2 max-w-xs text-sm text-ink/65">Transparence, précision, confiance pour les projets de construction et de rénovation.</p>
          </div>
          <nav aria-label="Informations utiles" className="flex flex-col gap-2 text-sm font-medium text-ink/75">
            <a className={`rounded-md hover:text-ink ${focus}`} href="#comment-ca-marche">Comment ça marche</a>
            <a className={`rounded-md hover:text-ink ${focus}`} href="#maitres-ouvrage">Pour les maîtres d’ouvrage</a>
            <a className={`rounded-md hover:text-ink ${focus}`} href="#professionnels">Pour les artisans et entreprises</a>
            <Link className={`rounded-md hover:text-ink ${focus}`} href="/auth/forgot-password">Mot de passe oublié</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
