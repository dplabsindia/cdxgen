const readInstalled = require("read-installed");
const spdxLicenses = require("./spdx-licenses.json");

/**
 * Performs a lookup + validation of the license specified in the
 * package. If the license is a valid SPDX license ID, set the 'id'
 * of the license object, otherwise, set the 'name' of the license
 * object.
 */
function getLicenses(pkg) {
    let license = pkg.license && (pkg.license.type || pkg.license);
    if (license) {
        if (!Array.isArray(license)) {
            license = [license];
        }
        return license.map(l => {
            if (spdxLicenses.includes(license)) {
                return { id : l };
            } else {
                return { name : l };
            }
        }).map(l => ({license: l}));
    }
    return [ { license: {} }];
}

/**
 * For all modules in the specified package, creates a list of
 * component objects from each one.
 */
function listComponents(pkg) {
    let list = {};
    addComponent(pkg, list);
    return Object.keys(list).map(k => ({ component: list[k] }));
}

/**
 * Given the specified package, create a CycloneDX component and add it to the list.
 */
function addComponent(pkg, list) {
    let purlName = pkg.name.replace("@", "%40"); // Encode 'scoped' npm packages in purl
    let component = {
        "@type"     : determinePackageType(pkg),
        name        : pkg.name,
        version     : pkg.version,
        description : `<![CDATA[${pkg.description}]]>`,
        hashes      : [],
        licenses    : getLicenses(pkg),
        purl        : `pkg:npm/${purlName}@${pkg.version}`,
        modified    : false
    };

    if (pkg._shasum) {
        component.hashes.push({ hash: { "@alg":"SHA-1", value: pkg._shasum} });
    } else {
        delete component.hashes; // If no hashes exist, delete the hashes node (it's optional)
    }
    if (list[component.purl]) return; //remove cycles
    list[component.purl] = component;
    if (pkg.dependencies) {
        Object.keys(pkg.dependencies)
            .map(x => pkg.dependencies[x])
            .filter(x => typeof(x) !== "string") //remove cycles
            .map(x => addComponent(x, list));
    }
}

/**
 * Creates a child XML node.
 */
function createChild(name, value, depth) {
    if (name === "value") return value;
    if (Array.isArray(value)) return `<${name}>${value.map(v => js2Xml(v, depth + 1)).join('')}</${name}>`;
    if (['boolean', 'string', 'number'].includes(typeof value)) return `<${name}>${value}</${name}>`;
    //console.log(name, value);
    throw new Error("Unexpected child: " + name + " " + (typeof value) );
}

/**
 * Converts the Javascript object to XML.
 */
function js2Xml(obj, depth) {
    return Object.keys(obj).map(key => {
        let attrs = Object.keys(obj[key])
            .filter(x => x.indexOf('@') === 0)
            .map(x => ` ${x.slice(1)}="${obj[key][x]}"`)
            .join('') || '';
        let children = Object.keys(obj[key])
            .filter(x => x.indexOf('@') === -1)
            .map(x => createChild(x, obj[key][x], depth + 1))
            .join('');
        return `<${key}${attrs}>${children}</${key}>`
    }).join("\n");
}

/**
 * If the author has described the module as a 'framework', the take their
 * word for it, otherwise, identify the module as a 'library'.
 */
function determinePackageType(pkg) {
    if (pkg.hasOwnProperty("keywords")) {
        for (keyword of pkg.keywords) {
            if (keyword.toLowerCase() === "framework") {
                return "framework";
            }
        }
    }
    return "library";
}

exports.createbom = (path, callback) => readInstalled(path, (err, pkgInfo) => {
	let result = { bom: { 
		"@xmlns"  :"http://cyclonedx.org/schema/bom/1.0",
		"@version": 1,
		components: listComponents(pkgInfo)
	}};
	callback(null, `<?xml version="1.0" encoding="UTF-8"?>\n${js2Xml(result,0)}`);
});