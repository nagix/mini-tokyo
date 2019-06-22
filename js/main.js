var map = L.map('map').setView([35.68, 139.75], 13);
var lineLookup = [];
var stationLookup = [];
var g;

// For development
L.DomUtil.addClass(map._container,'crosshair-cursor-enabled');

L.tileLayer('https://api.mapbox.com/v4/{id}/{z}/{x}/{y}@2x.png?access_token={accessToken}', {
	maxZoom: 18,
	attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, ' +
		'<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
		'Imagery &copy; <a href="https://www.mapbox.com/">Mapbox</a>',
	id: 'mapbox.streets',
	accessToken: accessToken
}).addTo(map);

L.easyButton('fab fa-github fa-lg', function(btn, easyMap){
	window.open('https://github.com/nagix/mini-tokyo');
}).addTo(map);

/* Initialize the SVG layer */
L.svg().addTo(map);

/* We simply pick up the SVG from the map object */
g = d3.select('#map').select('svg').select('g');

Promise.all([
	d3.json('data/lines.json'),
	d3.json('data/stations.json'),
	d3.json('data/cars.json')
]).then(function([lineData, stationData, carData]) {
	lineData.lines.forEach(function(line) {
		lineLookup[line.name] = line;
	});

	stationData.stations.forEach(function(station) {
		stationLookup[station.name] = station;
	});

	/* Add a LatLng object to each item in the dataset */
	lineData.lines.forEach(function(line) {
		line.path = line.path.map(function(point) {
			var latLag = new L.latLng(point[0], point[1]);
			latLag._offset = point[2];
			return latLag;
		});
	});

	stationData.stations.forEach(function(station) {
		var coords = station.coords;
		station.latLng = new L.latLng(coords[0], coords[1]);
	});

	var lineGenerator = d3.line()
		.x(function(d) {
			return map.latLngToLayerPoint(d).x + (d._offset && d._angle ? -d._offset * 8 * Math.sin(d._angle * Math.PI / 180) : 0);
		})
		.y(function(d) {
			return map.latLngToLayerPoint(d).y + (d._offset && d._angle ? d._offset * 8 * Math.cos(d._angle * Math.PI / 180) : 0);
		})
		.curve(d3.curveCardinal.tension(.4));

	var simpleLineGenerator = d3.line()
		.x(function(d) { return map.latLngToLayerPoint(d).x; })
		.y(function(d) { return map.latLngToLayerPoint(d).y; })
		.curve(d3.curveCardinal.tension(.4));

	updateLines();

	initPathAngles();

	update();

	transition(g.selectAll('.car'));

	map.on('moveend', update);

	// For development
	map.on('mousemove', function(e) {
		var latlng = map.layerPointToLatLng(L.point(e.layerPoint));
		console.log([latlng.lat.toFixed(4), latlng.lng.toFixed(4)]);
	});

	function updateLines() {
		var lines = g.selectAll('.line')
			.data(lineData.lines);
		lines.enter().append('path')
			.attr('class', function(d) { return d.name + ' line'; })
			.merge(lines)
			.attr('d', function(d) { return lineGenerator(d.path); });
	}

	function update() {
		updateLines();

		updateStationOffsets();

		// For development
		var points = g.selectAll('.point')
			.data(lineData.lines[0].path.concat(lineData.lines[1].path));
		points.enter().append("circle")
			.attr('class', 'point')
			.style('fill', 'white')
			.attr('r', 1.5)
			.merge(points)
			.attr('transform', function(d) {
				return 'translate(' +
					map.latLngToLayerPoint(d).x + ',' +
					map.latLngToLayerPoint(d).y + ')';
			});

		var cars = g.selectAll('.car')
			.data(carData.cars);
		cars.enter().append('rect')
			.attr('class', function(d) { return d.line + ' car'; })
			.attr('x', -10)
			.attr('y', -6)
			.attr('width', 20)
			.attr('height', 12)
			.attr('transform', function(d) {
				var path = g.select('.' + d.line + '.line').node();
				var length = path.getTotalLength();
				var p = getPointAtLengthWithRotation(path, d.sectionOffset * length, d.direction > 0 ? length : 0);
				return 'translate(' + p.x + ',' + p.y + ') rotate(' + p.angle + ')';
			});

		var stations = g.selectAll('.station')
			.data(stationData.stations)
		stations.enter().append("rect")
			.attr('class', 'station')
			.attr('x', function(d) { return d.span ? d.span[0] * 8 - 5 : -5; })
			.attr('y', -5)
			.attr('width', function(d) { return d.span ? (d.span[1] - d.span[0]) * 8 + 10 : 10; })
			.attr('height', 10)
			.attr('rx', 5)
			.attr('ry', 5)
			.merge(stations)
			.attr('transform', function(d) {
				return 'translate(' +
					map.latLngToLayerPoint(d.latLng).x + ',' +
					map.latLngToLayerPoint(d.latLng).y + ') rotate(' +
					((d.angle || 0) + 90) + ')';
			});
	}

	function transition(element) {
		element.transition()
			.duration(function(d) {return d.duration * Math.abs(d.sectionLength);})
			.attrTween('transform', translateAlong)
			.on('end', function(d) {
				var stations = lineLookup[d.line].stations;
				var direction = d.direction;
				var sectionIndex = d.sectionIndex + direction;

				if (sectionIndex <= 0) {
					sectionIndex = stations.length - 1;
				} else if (sectionIndex >= stations.length - 1) {
					sectionIndex = 0;
				}

				var sectionOffset = stations[sectionIndex].offset;
				var nextSectionOffset = stations[sectionIndex + direction].offset;

				d.sectionIndex = sectionIndex;
				d.sectionOffset = sectionOffset;
				d.sectionLength = nextSectionOffset - sectionOffset;

				transition(d3.select(this));
			});
	}

	function translateAlong(d) {
		var path = g.select('.' + d.line + '.line').node();
		return function(t) {
			var length = path.getTotalLength();
			var p = getPointAtLengthWithRotation(path, (d.sectionOffset + t * d.sectionLength) * length, d.direction > 0 ? length : 0);
			return 'translate(' + p.x + ',' + p.y + ') rotate(' + p.angle + ')';
		};
	}

	function getPointAtLengthWithRotation(path, length, end) {
		var p1 = path.getPointAtLength(length);
		var delta = end ? 1 : -1;

		if (Math.abs(end - length) >= 1) {
			p2 = path.getPointAtLength(length + delta);
			deg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
		} else {
			p2 = path.getPointAtLength(length - delta);
			deg = Math.atan2(p1.y - p2.y, p1.x - p2.x) * 180 / Math.PI;
		}

		return {
			x: p1.x,
			y: p1.y,
			angle: deg
		}
	}

	function initPathAngles() {
		lineData.lines.forEach(function(line) {
			var path = g.select('.' + line.name + '.line').node();
			var totalLength = path.getTotalLength();
			line.path.forEach(function(point) {
				var length = getLengthAtLatLng(line.path, point);
				var p = getPointAtLengthWithRotation(path, length, totalLength);
				point._angle = p.angle;
			})
		});
	}

	function updateStationOffsets() {
		lineData.lines.forEach(function(line) {
			var totalLength = g.select('.' + line.name + '.line').node().getTotalLength();
			line.stations.forEach(function(station, i, stations) {
				var length = getLengthAtLatLng(line.path, stationLookup[station.name].latLng, true);
				station.offset = length / totalLength;
			});
		});

		// Temporary workaround
		lineData.lines[0].stations[29].offset = 1;

		// Update section offsets and length for cars as well
		carData.cars.forEach(function(car) {
			var stations = lineLookup[car.line].stations;
			var sectionIndex = car.sectionIndex;
			var sectionOffset = stations[sectionIndex].offset;
			var nextSectionOffset = stations[sectionIndex + car.direction].offset;
			car.sectionOffset = sectionOffset;
			car.sectionLength = nextSectionOffset - sectionOffset;
		});
	}

	function getLengthAtLatLng(path, latLng, useOffset) {
		var subpath = [];
		var i, point, selection;

		for (i = 0; i < path.length; ++i) {
			point = path[i];
			if (point.lat === latLng.lat && point.lng === latLng.lng) {
				subpath = path.slice(0, i + 1);
				break;
			}
		}
		selection = g.selectAll('.subpath')
			.data([subpath]);
		selection.enter().append('path')
			.attr('class', 'subpath')
			.merge(selection)
			.attr('d', useOffset ? lineGenerator : simpleLineGenerator);

		return g.selectAll('.subpath').node().getTotalLength();
	}
});
