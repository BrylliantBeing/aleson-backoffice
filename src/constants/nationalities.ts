// Nationality options for the passenger manifest.
//
// Ordering is deliberate, not alphabetical: the two nationalities that make up
// almost every sailing (domestic Philippine routes and the Zamboanga–Sandakan
// international run) sit at the top so the common case is one tap, and the rest
// follow alphabetically for scanning/searching.
export const PINNED_NATIONALITIES = ['Filipino', 'Malaysian'] as const;

const OTHER_NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan',
  'Antiguan', 'Argentine', 'Armenian', 'Australian', 'Austrian', 'Azerbaijani',
  'Bahamian', 'Bahraini', 'Bangladeshi', 'Barbadian', 'Belarusian', 'Belgian',
  'Belizean', 'Beninese', 'Bhutanese', 'Bolivian', 'Bosnian', 'Botswanan',
  'Brazilian', 'British', 'Bruneian', 'Bulgarian', 'Burkinabe', 'Burmese',
  'Burundian', 'Cambodian', 'Cameroonian', 'Canadian', 'Cape Verdean',
  'Central African', 'Chadian', 'Chilean', 'Chinese', 'Colombian', 'Comoran',
  'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Cypriot', 'Czech',
  'Danish', 'Djiboutian', 'Dominican', 'Dutch', 'East Timorese', 'Ecuadorean',
  'Egyptian', 'Emirati', 'Equatorial Guinean', 'Eritrean', 'Estonian',
  'Ethiopian', 'Fijian', 'Finnish', 'French', 'Gabonese', 'Gambian',
  'Georgian', 'German', 'Ghanaian', 'Greek', 'Grenadian', 'Guatemalan',
  'Guinea-Bissauan', 'Guinean', 'Guyanese', 'Haitian', 'Honduran', 'Hungarian',
  'I-Kiribati', 'Icelandic', 'Indian', 'Indonesian', 'Iranian', 'Iraqi',
  'Irish', 'Israeli', 'Italian', 'Ivorian', 'Jamaican', 'Japanese',
  'Jordanian', 'Kazakhstani', 'Kenyan', 'Kosovar', 'Kuwaiti', 'Kyrgyz',
  'Laotian', 'Latvian', 'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner',
  'Lithuanian', 'Luxembourger', 'Macedonian', 'Malagasy', 'Malawian',
  'Maldivian', 'Malian', 'Maltese', 'Marshallese', 'Mauritanian', 'Mauritian',
  'Mexican', 'Micronesian', 'Moldovan', 'Monacan', 'Mongolian', 'Montenegrin',
  'Moroccan', 'Mozambican', 'Namibian', 'Nauruan', 'Nepalese', 'New Zealander',
  'Nicaraguan', 'Nigerian', 'Nigerien', 'North Korean', 'Norwegian', 'Omani',
  'Pakistani', 'Palauan', 'Palestinian', 'Panamanian', 'Papua New Guinean',
  'Paraguayan', 'Peruvian', 'Polish', 'Portuguese', 'Qatari', 'Romanian',
  'Russian', 'Rwandan', 'Saint Lucian', 'Salvadoran', 'Sammarinese', 'Samoan',
  'Saudi', 'Senegalese', 'Serbian', 'Seychellois', 'Sierra Leonean',
  'Singaporean', 'Slovak', 'Slovenian', 'Solomon Islander', 'Somali',
  'South African', 'South Korean', 'South Sudanese', 'Spanish', 'Sri Lankan',
  'Sudanese', 'Surinamese', 'Swazi', 'Swedish', 'Swiss', 'Syrian', 'Taiwanese',
  'Tajik', 'Tanzanian', 'Thai', 'Togolese', 'Tongan', 'Trinidadian',
  'Tunisian', 'Turkish', 'Turkmen', 'Tuvaluan', 'Ugandan', 'Ukrainian',
  'Uruguayan', 'Uzbek', 'Vanuatuan', 'Vatican', 'Venezuelan', 'Vietnamese',
  'Yemeni', 'Zambian', 'Zimbabwean',
];

export const NATIONALITIES: string[] = [...PINNED_NATIONALITIES, ...OTHER_NATIONALITIES];

export const DEFAULT_NATIONALITY = 'Filipino';
