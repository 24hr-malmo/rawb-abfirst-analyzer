const findNodes = (vcData, findFunction) => {
    if (!vcData) {
        return;
    }

    let found = [];

    vcData.forEach(item => {
        if (findFunction(item)) {
            found.push(item);
        }
        else if (item.children) {
            const subFound = findNodes(item.children, findFunction);
            found.push.apply(found, subFound);
        }
    });

    return found;
};

const findVcItems = (vcData, ...vcModuleNames) => {
    return findNodes(vcData, node => {
        return vcModuleNames.includes(node.name);
    });
};

exports.findVcItems = findVcItems;
