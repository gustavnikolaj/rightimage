const getFilterInfosAndTargetContentTypeFromQueryString = require("express-processimage/lib/getFilterInfosAndTargetContentTypeFromQueryString");
const queryString = require("querystring");

const OrientationDecoder = require("./OrientationDecoder");

function arrangeImageTransformsAndApply(contentType, imageOptions) {
    const queryAsString = queryString.stringify(imageOptions, null, null, {
        encodeURIComponent: str => str
    });
    const expressProcessImageResult = getFilterInfosAndTargetContentTypeFromQueryString(
        queryAsString,
        {
            defaultEngineName: "sharp",
            sourceMetadata: { contentType }
        }
    );

    const filterInfos = expressProcessImageResult.filterInfos;
    if (filterInfos.length === 0) {
        throw new Error("No image transforms were generated for application");
    }

    let imageFilterStream = null;
    let lastImageFilterStream;

    filterInfos.forEach(filterInfo => {
        const transformStream = filterInfo.create();

        if (imageFilterStream === null) {
            imageFilterStream = transformStream;
            lastImageFilterStream = transformStream;
        } else {
            lastImageFilterStream.pipe(transformStream);
            lastImageFilterStream = transformStream;
        }
    });

    return { input: imageFilterStream, output: lastImageFilterStream };
}

function makeOutputContentType(contentType, imageOptions) {
    if (imageOptions && imageOptions.setFormat) {
        let outFormat = imageOptions.setFormat;
        if (outFormat === "jpg") {
            outFormat = "jpeg";
        }
        return `image/${outFormat}`;
    } else {
        return contentType;
    }
}

function createRightImagePipeline(
    { inputStream, contentType, imageOptions },
    callback
) {
    const orientationDecodingStream = new OrientationDecoder(inputStream);
    orientationDecodingStream.once("error", err => callback(err));
    orientationDecodingStream.on("rotation", rotate => {
        // include the rotation in the applied options
        imageOptions = { rotate, ...imageOptions };
    });
    orientationDecodingStream.on("stream", stream => {
        if (imageOptions === null) {
            // no transformation was requested
            return callback(null, {
                outputContentType: contentType,
                outputStream: stream
            });
        }

        const { input, output } = arrangeImageTransformsAndApply(
            contentType,
            imageOptions
        );

        // send the complete image data into the image pipeline (.resume() called automatically)
        stream.pipe(input);
        // propogate errors
        stream.on("error", error => output.emit("error", error));

        callback(null, {
            outputContentType: makeOutputContentType(contentType, imageOptions),
            outputStream: output
        });
    });
}

module.exports = createRightImagePipeline;