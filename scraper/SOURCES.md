# Brand source discovery

## Hyundai
- Models+ids: https://api.hyundai.co.in/service/price/getModels (also #car options on price page: 24 Nios,39 i20,41 i20NL,35 Aura,45 Verna,50 Venue,37 Creta,40 Alcazar,46 Exter,47 CretaNL,51 VenueNL,44 Ioniq5,48 CretaEV,52 Prime)
- States: getStatesByModel?modelId= ; cities: getPriceCitiesByModelIdAndStateId?stateId=&modelId= ; prices: getPriceByModelAndCity?cityId=&modelId= -> [{fuelType, price "10 99 200", variant, engine, transmission, edition, fullDescription}]
- Features: https://www.hyundai.com/in/en/find-a-car/<slug>/features -> static <table>s, header row = trims, cells S/O/-/text
- Specs: /<slug>/specification (per engine, JS tabs)
- NOTE: API reachable with CORS from www.hyundai.com; unknown from US IPs.

## Tata
- Domain moved to tata.cars (ICE) and ev.tata.cars (EV)
- https://tata.cars/<model>/ice/specifications.html -> div.productspecs-results[data-productspecjson] JSON: results.variantSpecFeature[] {variantId, variantLabel "Smart 1.2, Petrol", startingPrice "₹7,39,990", productSpecifications[{specType, specList[{specLabel, specValue}]}], productFeatures[{featureType, featureList[{featureLabel, featureValue}]}]}
- Price = Mumbai default city ex-showroom. Price API flaky (504).
- Models: Aeris Sierra Harrier Safari Nexon Punch Altroz Tiago Curvv (+ EVs, Tigor?)

## Maruti Suzuki (Arena; Nexa likely same platform with channel NRC)
- Model list: https://www.marutisuzuki.com/graphql/execute.json/msil-platform/ArenaCarList  (carModelCommercialList.items[].modelCd)
- Features per variant: /graphql/execute.json/msil-platform/ArenaVariantDetailCompare;modelCd=SI;channel=NRM;locale=en;  -> variants[].specificationCategory[].specificationAspect[] {categoryLabel, <camelCaseFeature>: "Yes"/"No"/value/null}
- Summary: /graphql/execute.json/msil-platform/VariantFeaturesList;modelCd=SI;locale=en;  (fuelEfficiency, seating, transmissionType, displacement)
- Price: /pricing/v2/common/pricing/ex-showroom-detail?forCode=08&channel=NRM%2CNRC&variantInfoRequired=true&modelCodes=SI -> exShowroomPrice per variantCd & colorType (M/NM)
- forCode per city: /dms/v1/api/common/msil/dms/dealer-only-cities?channel=NRM (740KB; stateCode, cityDesc, forCode). forCode 08 = Delhi
- NEXA: https://www.nexaexperience.com same API, channel=EXC. Models: NexaCarList; features: VariantDetailCompare;modelCd=GV;channel=EXC;locale=en; ; price ex-showroom-detail?forCode=08&channel=EXC&variantInfoRequired=true&modelCodes=GV ; cities dealer-only-cities?channel=EXC

## Mahindra (Salesforce Commerce Cloud)
- Model pids from https://auto.mahindra.com/own-online/variant-selection?pid=XXX links: THRN(Thar Roxx) SCN(Scorpio N) X7XO(XUV 7XO) TH5D? X3XO(XUV 3XO) SCRC(Scorpio Classic) NEO(Bolero Neo) BOL(Bolero) NEOP(Bolero Neo+) X400(XUV400). EVs (BE 6, XEV 9e, XEV 9S) probably on mahindraelectricsuv.com
- Variants: /on/demandware.store/Sites-amc-Site/en_IN/Product-Variation?pid=X7XO&dwvar_X7XO_fuelType=..&dwvar_X7XO_gearBoxType=..&dwvar_X7XO_seatingCapacity=..&dwvar_X7XO_variantCode=M0945 -> JSON product.variationAttributes (selectable values); variant-selection page HTML has .item-card[data-variantname][data-priceobj][data-attr-value] for each combination
- Features per variant: NOT on site structurally -> brochure PDF or leave partial.

## Kia
- Models: /in/our-vehicles/<slug>/showroom.html ; specs: /in/our-vehicles/<slug>/specs.html
- specs.html: a.tab[data-trim-name][data-price][data-fsc-code] per trim (starting ex-showroom); ul.specs-highlights-list[data-spec=TRIM] li = features per trim; ul.specs-list = dimensions etc.
- State/city list: /api/kia2_in/getAQuote.getQuoteData.do
- Trim-level only (engine/gearbox variants not split) unless a price API found.

## Toyota
- API base https://webapi.toyotabharat.com/ (POST, XML): 1.0/api/pricestates ; 1.0/api/pricestates/{stateId}/pricecities ; 1.0/api/businesscities/{cityId}/websalesdealers ; 1.0/api/price/models ; 1.0/api/price/model/{modelId} ; 1.0/api/price/list/{dealerId}/{priceModelId} -> per-grade ex-showroom per dealer (state-level prices!)
- Model ids: 20 Glanza,33 Taisor,31 Rumion,27 Hyryder,...
- Features: spec brochure PDFs https://www.toyotabharat.com/documents/brochures/e-brochure-<slug>-spec.pdf

## Honda (Next.js)
- Models: GET https://www.hondacarindia.com/api/getAllCarsData (carModelId, carModelSiteUrl, ...)
- Features per trim: https://www.hondacarindia.com/<site>/tech-specs  __NEXT_DATA__ props.pageProps.techAndSpecsData[0] (feature: TnSCarModels trims, TnSTypeData[].TnSTypeData[] {TnSDataTitle, TnSDataArr[i].TnSIsTrue 'Y'/'-'/text}); [1] = specs per engine
- Price: POST /api/getCarPrice {carID, city:'Delhi', fuelType:'Petrol', transmission:'MT (Manual)'|'CVT'?, variant:'V'} -> P_Price (ex-showroom); returns totalPrice 0 if combo invalid
- States/cities: /api/getAllStates, /api/getAllCities?stateId=

## Skoda
- Prices: https://skodapeaceofmind.co.in/Skoda_TCD/checkprice/checkprice.aspx ; POST ./CheckPrice.aspx/GetPrice {selectedModel:'Kushaq', fuelType:'Petrol', transmissionType:'Manual'|'Automatic'} -> d[] {Variant, ExshowroomPrice "10 69 000"}; models in select#drpModels (Octavia RS, Kodiaq RS, Kushaq, Slavia, Kylaq, Kodiaq)
- Features: model pages https://www.skoda-auto.co.in/models/<m>/<m> embed trim blocks in React props (HTML-escaped JSON); variant features => TODO brochure
- GitHub Actions: skoda-auto.co.in 200

## Volkswagen
- Models: /en/models/{virtus,taigun,tayron,tiguan-r-line,golf-gti}.html (+ -sport/-chrome sub pages)
- Price table: /en/models/<m>.html/__layer/layers/price/<slug>/master.layer -> <table> Variants | Ex-Showroom Price  (slug from link on model page, e.g. the-new-taigun)
- Specs tables: /en/models/<m>.html/__layer/layers/specifications/<m>/master.layer (per engine)
- Features: brochure PDF only

## Renault
- Models: /cars/renault-{duster,triber,kiger,kwid}/configurator.html
- window.APP_STATE = JSON.parse("...") in inline script: page.data.modelParams.data.grades[] {label, versions[] {label, engineName, gearboxTypeCode BVM5/BVR5(AMT)/CVTX, mainFuelTypeCode ESS=petrol, startingPrice}}
- page.data.content.contentZone.configurator.staticData.usp[] per grade (ENS_..LIM1..n) key equipments (cumulative); engines[] specs

## Nissan
- https://www.nissan.in/prices-list.html -> 10 tables "Variant | Ex-Showroom Price (INR)" (Tekton, Gravite, Magnite, X-Trail...). Model = table heading/variant prefix.
- Features: brochures https://www.nissan.in/vehicles/brochures.html

## MG
- Spec page per model: https://www.mgmotor.co.in/vehicles/<slug>/specifications (slugs: mgastor, mghector, windsor-ev-electric-car-in-india, windsor-ev-pro, comet-ev-electric-car-in-india, mgzsev-electric-car-in-india, mg-majestor-biggest-suv-india, hector-tomahawk/ev|phev ...) ; variants: input[name=variants][data-model-name][data-model-sales-code]
- Features+price: GET https://jpkzrf9kjg.execute-api.ap-south-1.amazonaws.com/prod/carcomparison/internal?variantID=<code> header x-api-key: MtZz8KL50230EbLicq0fq8i5zJMrcihp5uthionf (key from page input#internalCarComparisonkey) -> [{Price, MODEL_TEXT1, variants[{Categories[{CategoryName, CategoriesValues[{AttributeName, AttributeValue}]}]}]}]
- Price = Delhi ex-showroom presumably
