export const SITE_NAME='EGM Growth Dashboard'
export const SITE_DESCRIPTION='Traffic, adoption, development and research metrics for the Elephant Goldfish Model.'
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')

// Description, Open Graph and Twitter tags. The image URL must be absolute for link unfurlers.
export function siteMeta(appUrl='https://egm.n3wth.com',title=SITE_NAME) {
  const image=`${appUrl}/og.png`
  const tags=[
    ['name','description',SITE_DESCRIPTION],
    ['property','og:type','website'],
    ['property','og:site_name',SITE_NAME],
    ['property','og:title',title],
    ['property','og:description',SITE_DESCRIPTION],
    ['property','og:url',appUrl],
    ['property','og:image',image],
    ['property','og:image:type','image/png'],
    ['property','og:image:width','1200'],
    ['property','og:image:height','630'],
    ['property','og:image:alt',SITE_NAME],
    ['name','twitter:card','summary_large_image'],
    ['name','twitter:title',title],
    ['name','twitter:description',SITE_DESCRIPTION],
    ['name','twitter:image',image],
  ]
  return tags.map(([attr,key,value])=>`<meta ${attr}="${key}" content="${escape(value)}">`).join('')
}
