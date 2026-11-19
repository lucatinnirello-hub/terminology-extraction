# Kyrgyz stopword list: draft for review

For the n8n *Stopword lists* node, `EXTRA_STOPWORDS.ky`. Used only when Kyrgyz is the **target** language of an extraction job with translation suggestions; wildcards-only jobs don't use it.

**How it's used.** The list marks where a candidate phrase ends: a stopword can never be inside a term. So two kinds of mistake matter:

- A **missing** function word lets phrases run together (*ал клапан* instead of *клапан*).
- A **wrong** entry (a content word) cuts real terms in half. When in doubt, leave a word out.

**How it was made.** The 574-word English list (from YAKE) was used as a checklist, translated, and filtered: words that become endings in Kyrgyz, content words and junk were dropped; the case forms of pronouns and demonstratives were added. Result: 231 words. Drafted without a native speaker: please check every group.

## The list, by group

| Group | English equivalents | Kyrgyz words |
|---|---|---|
| Conjunctions and linking words | and, or, but, because, therefore, if, then, otherwise, now, so | жана, же, бирок, анткени, ошондуктан, демек, ошентип, эгер, эгерде, антпесе, болбосо, анан, эми, ошондо, мисалы |
| Particles | also, too, even, just, only, yes, thanks | да, дагы, деле, эле, гана, го, чы, ооба, рахмат |
| Postpositions | with, for, about, via, like, as, until, after, before, since, from, towards, regarding, by, despite, together, instead of, besides, during, per | менен, үчүн, боюнча, жөнүндө, тууралуу, аркылуу, сыяктуу, катары, чейин, кийин, мурун, бери, тартып, карата, карай, тарабынан, карабастан, бирге, ордуна, тышкары, учурунда, убагында, сайын |
| Place words in the locative (in, under, in front of, behind, beside, between, among, outside, on top) | in/within, under, before, behind, beside, between, among, outside, above | ичинде, астында, алдында, артында, жанында, ортосунда, арасында, сыртында, үстүндө |
| Personal pronouns, all cases (nominative, genitive, dative, accusative, locative, ablative) | I, you, he/she/it, we, they, me, my, him, his... | мен, менин, мага, мени, менде, менден, сен, сенин, сага, сени, сенде, сенден, ал, анын, ага, аны, анда, андан, биз, биздин, бизге, бизди, бизде, бизден, сиз, сиздин, сизге, сизди, сизде, сизден, сиздер, силер, силердин, силерге, силерди, силерде, силерден, алар, алардын, аларга, аларды, аларда, алардан |
| Reflexive (self, own, each other) | self, itself, own, each other | өз, өзү, өзүм, өзүң, өзүбүз, өздөрү, өзүнүн, өзүнө, өзүн, өзүндө, өзүнөн, бири-бири, бири-бирин, бири-бирине |
| Demonstratives, all cases | this, that, these, those, here, there, such | бул, мунун, буга, муну, мында, мындан, булар, булардын, буларга, буларды, буларда, булардан, ошол, ошо, ошонун, ошого, ошону, ошондон, ошолор, ушул, ушунун, ушуга, ушуну, ушунда, ушундан, тиги, мына, мындай, андай, ушундай, ошондой, мынча, анча, ушунча, ошончо |
| Question words | who, what, where, when, how, why, which, how much, what kind | ким, кимдин, кимге, кимди, эмне, эмненин, эмнеге, эмнени, кайда, кайдан, качан, кантип, кайсы, канча, кандай, неге |
| Quantifiers | all, every, each, some, several, none, nothing, other, both | бардык, баары, бардыгы, баарын, баарына, баарынан, бүт, ар, бир, кээ, айрым, нече, эч, нерсе, башка, башкалар, экөө |
| Adverbs of degree and time | very, most, almost, at all, mostly, mainly, usually, always, now, yet/still, previously, later, immediately, maybe, possible | өтө, абдан, эң, дээрлик, такыр, көбүнчө, негизинен, адатта, дайыма, дайым, азыр, али, мурда, кийинчерээк, дароо, балким, мүмкүн |
| Auxiliary and finite verb forms | be/is/was, there is/isn't, not, must, should, can, said/called, do/make | болот, болгон, болуп, болсо, болбойт, болду, болуш, болушу, болушат, болгондо, болгондуктан, болуучу, экен, эмес, бар, жок, керек, тийиш, алат, жатат, турат, деп, деген, делген, дейт, кылат, кылып, кылган, кылынат, кылынган, этет, этип, эткен |

## Please check especially

| Word(s) | Question |
|---|---|
| бир | Also starts terms like *бир фазалуу* (single-phase). Keep or drop? |
| ичинде, астында, алдында, артында, жанында, ортосунда, арасында, сыртында, үстүндө | Place words. Could any of them sit inside a term in your clients' fields? |
| мүмкүн | Kept as *maybe/possible*. Check it doesn't cut *мүмкүн болгон* phrases you want. |
| алат, жатат, турат, этет | Auxiliaries; they're also full verbs (*take, lie, stand, do*). Finite forms rarely sit in terms, but check. |
| бүт, айрым, башка | *all, some/separate, other*. Check none start common terms. |
| Missing forms | Anything frequent in your clients' texts that isn't here, especially other case forms (plural demonstratives, *кимден*, *эмнеден*…). |

## Left out, and why

| Kind | English words | Why |
|---|---|---|
| Became an ending or nothing at all | a, an, the (no articles); of (genitive -нын); in, at, on (locative -да); to, into, toward (dative -га); from (ablative -дан); my, your, his, its, our, their (possessive endings; the genitive pronouns *менин, анын…* are in the list instead); am, is, are (copula endings or nothing); contractions (*aren't, it's, we've…*) | A stopword list only matches whole words. |
| Would cut real Kyrgyz terms in half | many/more/most/few/less (*көп, аз, көбүрөөк*: *көп каналдуу*, *аз чыгымдуу*); against (*каршы*: *өрткө каршы коргоо*); again (*кайра, кайрадан*: *кайра иштетүү*, *кайра жүктөө*); both (*тең*: *тең салмактуу*); only (*жалаң*: *жалаң зым*); because (*себеби*: *бузулуунун себеби*); according to (*ылайык*, also *suitable*); associated (*байланыштуу*, from *байланыш*, connection/communication); new, old, next, last, first, inner, right, near, far, whole, special/particular, necessary, available, appropriate, useful, different, best, better, certain, known, value, name, use/used | These are content words in Kyrgyz, or start compound terms. |
| Content verbs | use, provide, contain, indicate, specify, follow, place, send, see, seem, look, want, wish, try, keep, give, take, get, go, come, ask, help, think, know, tell | Their verbal nouns (*колдонуу, камсыз кылуу…*) appear inside terms (*колдонуу боюнча нускама*). Only finite auxiliary forms are kept. |
| Numbers | one…nine, zero, first, second, third (*эки, үч, биринчи…*) | They start technical terms (*үч фазалуу кыймылдаткыч*). *бир* is kept because it also works as the article *a* and in *ар бир, кээ бир, бир нече*: check it. |
| Too many possible translations | can, will, may, might, shall, well, up, down, still, mean, like (verb), right | Future and modal meanings are verb endings; the rest depend on context. *алат* (can) and *керек/тийиш* (must) are kept. |
| Junk in the English list | single letters, abbreviations (co, com, edu, eg, ie, etc, inc, ltd, dr, mr, ms, qv, viz, vs, uucp, th, rd, nd, sub, sup, un, non, ex, et, que), greetings and chat (hello, hi, c'mon, ok, okay, sorry, thanx, greetings, welcome) | Not useful in Kyrgyz. |

## Ready to paste

Into `EXTRA_STOPWORDS` in the *Stopword lists* node (`n8n/code/0b-stopword-lists.js`):

```js
  // Kyrgyz has no YAKE list: this one was made from the English list and
  // filtered for Kyrgyz. Used as a TARGET language only.
  // Conjunctions and linking words
  'жана', 'же', 'бирок', 'анткени', 'ошондуктан', 'демек', 'ошентип', 'эгер', 'эгерде',
  'антпесе', 'болбосо', 'анан', 'эми', 'ошондо', 'мисалы',
  // Particles
  'да', 'дагы', 'деле', 'эле', 'гана', 'го', 'чы', 'ооба', 'рахмат',
  // Postpositions
  'менен', 'үчүн', 'боюнча', 'жөнүндө', 'тууралуу', 'аркылуу', 'сыяктуу', 'катары',
  'чейин', 'кийин', 'мурун', 'бери', 'тартып', 'карата', 'карай', 'тарабынан',
  'карабастан', 'бирге', 'ордуна', 'тышкары', 'учурунда', 'убагында', 'сайын',
  // Place words in the locative
  'ичинде', 'астында', 'алдында', 'артында', 'жанында', 'ортосунда', 'арасында',
  'сыртында', 'үстүндө',
  // Personal pronouns, all cases
  'мен', 'менин', 'мага', 'мени', 'менде', 'менден', 'сен', 'сенин', 'сага', 'сени',
  'сенде', 'сенден', 'ал', 'анын', 'ага', 'аны', 'анда', 'андан', 'биз', 'биздин', 'бизге',
  'бизди', 'бизде', 'бизден', 'сиз', 'сиздин', 'сизге', 'сизди', 'сизде', 'сизден',
  'сиздер', 'силер', 'силердин', 'силерге', 'силерди', 'силерде', 'силерден', 'алар',
  'алардын', 'аларга', 'аларды', 'аларда', 'алардан',
  // Reflexive
  'өз', 'өзү', 'өзүм', 'өзүң', 'өзүбүз', 'өздөрү', 'өзүнүн', 'өзүнө', 'өзүн', 'өзүндө',
  'өзүнөн', 'бири-бири', 'бири-бирин', 'бири-бирине',
  // Demonstratives, all cases
  'бул', 'мунун', 'буга', 'муну', 'мында', 'мындан', 'булар', 'булардын', 'буларга',
  'буларды', 'буларда', 'булардан', 'ошол', 'ошо', 'ошонун', 'ошого', 'ошону', 'ошондон',
  'ошолор', 'ушул', 'ушунун', 'ушуга', 'ушуну', 'ушунда', 'ушундан', 'тиги', 'мына',
  'мындай', 'андай', 'ушундай', 'ошондой', 'мынча', 'анча', 'ушунча', 'ошончо',
  // Question words
  'ким', 'кимдин', 'кимге', 'кимди', 'эмне', 'эмненин', 'эмнеге', 'эмнени', 'кайда',
  'кайдан', 'качан', 'кантип', 'кайсы', 'канча', 'кандай', 'неге',
  // Quantifiers
  'бардык', 'баары', 'бардыгы', 'баарын', 'баарына', 'баарынан', 'бүт', 'ар', 'бир', 'кээ',
  'айрым', 'нече', 'эч', 'нерсе', 'башка', 'башкалар', 'экөө',
  // Adverbs of degree and time
  'өтө', 'абдан', 'эң', 'дээрлик', 'такыр', 'көбүнчө', 'негизинен', 'адатта', 'дайыма',
  'дайым', 'азыр', 'али', 'мурда', 'кийинчерээк', 'дароо', 'балким', 'мүмкүн',
  // Auxiliary and finite verb forms
  'болот', 'болгон', 'болуп', 'болсо', 'болбойт', 'болду', 'болуш', 'болушу', 'болушат',
  'болгондо', 'болгондуктан', 'болуучу', 'экен', 'эмес', 'бар', 'жок', 'керек', 'тийиш',
  'алат', 'жатат', 'турат', 'деп', 'деген', 'делген', 'дейт', 'кылат', 'кылып', 'кылган',
  'кылынат', 'кылынган', 'этет', 'этип', 'эткен',
```

(Wrap the lines above in `ky: [ ... ],`.)
