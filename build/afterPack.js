// Embeds the Argon icon + version metadata into the Windows Argon.exe.
// We run this ourselves (via the afterPack hook) because the build uses
// `win.signAndEditExecutable: false` to dodge electron-builder's winCodeSign
// download, which also skips its own rcedit pass.
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const rceditMod = require('rcedit');
  const rcedit = typeof rceditMod === 'function' ? rceditMod : (rceditMod.rcedit || rceditMod.default);

  const productName = context.packager.appInfo.productFilename; // "Argon"
  const version = context.packager.appInfo.version;
  const exe = path.join(context.appOutDir, `${productName}.exe`);
  const icon = path.join(__dirname, 'icon.ico');

  await rcedit(exe, {
    icon,
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'Argon',
      FileDescription: 'Argon — worksheet flashcards',
      CompanyName: 'Argon',
      LegalCopyright: `Copyright © ${new Date().getFullYear()} Hyrum Kugath`,
      OriginalFilename: `${productName}.exe`,
      InternalName: productName,
    },
  });
  console.log(`  • afterPack: embedded icon + version into ${productName}.exe`);
};
