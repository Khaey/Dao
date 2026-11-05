import test from 'node:test';
import assert from 'node:assert/strict';
import { awardedLotsLabel, canPreparePublication, journeyPhase, nextStep, phaseLabel, phaseTone, type JourneyInput } from '../src/project-journey/presentation.js';

const published = (extra: Partial<JourneyInput> = {}): JourneyInput => ({ projectStatus: 'open', versionStatus: 'approved', stage: 'not_started', lots: 2, awardedLots: 0, ...extra });

test('dossier phases follow the latest version while the chantier is not published', () => {
  assert.equal(journeyPhase({ projectStatus: 'draft', versionStatus: null }), 'draft');
  for (const status of ['draft', 'rejected', 'client_review', 'dao_review', 'approved']) assert.equal(journeyPhase({ projectStatus: 'draft', versionStatus: status }), status);
  assert.equal(journeyPhase({ projectStatus: 'draft', versionStatus: 'unexpected' }), 'draft');
  assert.equal(journeyPhase({ projectStatus: 'archived', versionStatus: 'approved', awardedLots: 2, lots: 2 }), 'archived');
});

test('« Prêt à publier » never persists once the chantier is published (#568)', () => {
  // The latest version stays « approved » after publication: the lifecycle wins.
  assert.equal(phaseLabel(published()), 'Publié');
  assert.equal(phaseLabel(published({ projectStatus: 'closed' })), 'Publication clôturée');
  assert.equal(phaseLabel({ projectStatus: 'draft', versionStatus: 'approved' }), 'Prêt à publier');
});

test('attribution is computed per lot, never as a global fictitious state', () => {
  assert.equal(journeyPhase(published({ awardedLots: 1 })), 'partially_awarded');
  assert.equal(phaseLabel(published({ awardedLots: 1 })), '1 lot sur 2 attribué');
  assert.equal(phaseLabel(published({ lots: 3, awardedLots: 2 })), '2 lots sur 3 attribués');
  assert.equal(phaseLabel(published({ awardedLots: 2 })), 'Tous les lots attribués');
  assert.equal(phaseLabel(published({ lots: 1, awardedLots: 1 })), 'Artisan choisi');
  // Unknown lot count: partial wording, never « tous ».
  assert.equal(phaseLabel(published({ lots: null, awardedLots: 1 })), 'Partiellement attribué');
  // Unknown attribution: no attribution is claimed.
  assert.equal(journeyPhase(published({ awardedLots: null })), 'published');
  // An attributed lot on a closed publication stays attributed.
  assert.equal(journeyPhase(published({ projectStatus: 'closed', awardedLots: 2 })), 'awarded');
});

test('works phases require a real attribution', () => {
  assert.equal(journeyPhase(published({ awardedLots: 2, stage: 'in_progress' })), 'works');
  assert.equal(journeyPhase(published({ awardedLots: 1, stage: 'completed' })), 'completed');
  assert.equal(journeyPhase(published({ awardedLots: 0, stage: 'in_progress' })), 'published');
  assert.equal(phaseTone('partially_awarded'), 'clay');
  assert.equal(phaseTone('awarded'), 'teal');
  assert.equal(phaseTone('rejected'), 'red');
});

test('publication is offered only for approved versions with unpublished, unawarded lots', () => {
  assert.equal(canPreparePublication({ projectStatus: 'draft', versionStatus: 'approved', lotsToPublish: 2 }), true);
  assert.equal(canPreparePublication({ projectStatus: 'open', versionStatus: 'approved', lotsToPublish: 0 }), false);
  assert.equal(canPreparePublication({ projectStatus: 'open', versionStatus: 'approved', lotsToPublish: null }), false);
  assert.equal(canPreparePublication({ projectStatus: 'draft', versionStatus: 'dao_review', lotsToPublish: 1 }), false);
  assert.equal(canPreparePublication({ projectStatus: 'archived', versionStatus: 'approved', lotsToPublish: 1 }), false);
});

test('the Client is never told to publish: D.A.O. publishes an approved dossier', () => {
  const step = nextStep('client', { projectStatus: 'draft', versionStatus: 'approved' });
  assert.equal(step.owner, 'dao');
  assert.match(step.text, /Aucune action de votre part/);
  assert.equal(nextStep('client', { projectStatus: 'draft', versionStatus: 'client_review', hasManager: false }).text, 'Dossier transmis : il attend sa prise en charge par un Gestionnaire D.A.O.');
  assert.equal(nextStep('client', { projectStatus: 'draft', versionStatus: 'draft' }).owner, 'you');
});

test('Client next step after publication depends on offers and remaining lots', () => {
  assert.equal(nextStep('client', published({ offersToCompare: true })).text, 'Comparez les offres reçues et attribuez lot par lot.');
  assert.equal(nextStep('client', published()).owner, 'none');
  assert.match(nextStep('client', published({ awardedLots: 1, offersToCompare: true })).text, /lots restants \(1 lot\)/);
  assert.match(nextStep('client', published({ lots: 3, awardedLots: 1 })).text, /^2 lots sans Artisan/);
  assert.match(nextStep('client', published({ awardedLots: 2 })).text, /conditions/);
  assert.match(nextStep('client', published({ awardedLots: 2, stage: 'in_progress' })).text, /suivi du chantier/);
});

test('staff actions are owned only by the assigned manager or an Admin', () => {
  const approved = { projectStatus: 'draft', versionStatus: 'approved', lotsToPublish: 2 };
  assert.deepEqual(nextStep('staff', approved), { text: 'Préparer la publication des lots approuvés.', owner: 'you' });
  const readonly = nextStep('staff_readonly', approved);
  assert.equal(readonly.owner, 'dao');
  assert.match(readonly.text, /lecture seule/);
  assert.equal(nextStep('staff', { projectStatus: 'draft', versionStatus: 'client_review', hasManager: false }).text, 'Prendre en charge le dossier.');
  assert.equal(nextStep('staff', { projectStatus: 'draft', versionStatus: 'draft' }).owner, 'client');
});

test('staff never sees « préparer la publication » for a published, fully attributed chantier', () => {
  const step = nextStep('staff', published({ awardedLots: 2, lotsToPublish: 0 }));
  assert.equal(step.owner, 'client');
  assert.doesNotMatch(step.text, /publication/i);
  assert.match(nextStep('staff', published({ awardedLots: 1, lotsToPublish: 1 })).text, /^Publier 1 lot approuvé non encore publié/);
  assert.equal(nextStep('staff', published({ awardedLots: 1, lotsToPublish: 0 })).owner, 'client');
});

test('other participants get an explanation, never an action they do not own', () => {
  for (const input of [{ projectStatus: 'draft', versionStatus: 'approved' }, published(), published({ awardedLots: 1 }), published({ awardedLots: 2 })]) {
    assert.notEqual(nextStep('participant', input).owner, 'you');
  }
  assert.equal(nextStep('participant', { projectStatus: 'archived' }).text, 'Chantier archivé : consultation uniquement.');
});

test('one shared wording for partial attribution across lists and fiches', () => {
  assert.equal(awardedLotsLabel(1, 2), '1 lot sur 2 attribué');
  assert.equal(awardedLotsLabel(2, 5), '2 lots sur 5 attribués');
});
